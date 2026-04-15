import { logger } from './logger';

/** Column filter payload from AG Grid (v33 community column filters) */
export interface ColumnFilterPayload {
  filterType?: string;
  type?: string;
  filter?: string | number | null;
  filterTo?: string | number | null;
  dateFrom?: string | null;
  dateTo?: string | null;
}

/**
 * Escape user input for safe use inside MongoDB $regex (bounded string).
 */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function isSafeFieldPath(path: string): boolean {
  if (!path || path.length > 256) return false;
  // Allow letters, numbers, underscore, dot
  return /^[a-zA-Z0-9_.]+$/.test(path);
}

function buildTextCondition(
  field: string,
  type: string | undefined,
  raw: string | number | null | undefined
): Record<string, unknown> | null {
  const t = (type ?? 'equals').toLowerCase();

  if (t === 'blank') {
    return {
      $or: [{ [field]: { $in: [null, ''] } }, { [field]: { $exists: false } }],
    };
  }
  if (t === 'notblank' || t === 'notBlank') {
    return {
      [field]: { $exists: true, $nin: [null, ''] },
    } as Record<string, unknown>;
  }

  if (raw === undefined || raw === null || raw === '') return null;
  const filter = String(raw);

  switch (t) {
    case 'equals':
      return { [field]: filter };
    case 'notequal':
    case 'notEqual':
      return { [field]: { $ne: filter } };
    case 'contains':
      return { [field]: { $regex: escapeRegex(filter), $options: 'i' } };
    case 'notcontains':
    case 'notContains':
      return { [field]: { $not: { $regex: escapeRegex(filter), $options: 'i' } } };
    case 'startswith':
    case 'startsWith':
      return { [field]: { $regex: `^${escapeRegex(filter)}`, $options: 'i' } };
    case 'endswith':
    case 'endsWith':
      return { [field]: { $regex: `${escapeRegex(filter)}$`, $options: 'i' } };
    default:
      return { [field]: { $regex: escapeRegex(filter), $options: 'i' } };
  }
}

function buildNumberCondition(
  field: string,
  type: string | undefined,
  raw: string | number | null | undefined
): Record<string, unknown> | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (Number.isNaN(n)) return null;
  const t = (type ?? 'equals').toLowerCase();

  switch (t) {
    case 'equals':
      return { [field]: n };
    case 'notequal':
    case 'notEqual':
      return { [field]: { $ne: n } };
    case 'greaterthan':
    case 'greaterThan':
      return { [field]: { $gt: n } };
    case 'greaterthanorequal':
    case 'greaterThanOrEqual':
      return { [field]: { $gte: n } };
    case 'lessthan':
    case 'lessThan':
      return { [field]: { $lt: n } };
    case 'lessthanorequal':
    case 'lessThanOrEqual':
      return { [field]: { $lte: n } };
    default:
      return { [field]: n };
  }
}

function buildDateCondition(
  field: string,
  type: string | undefined,
  dateFrom?: string | number | null,
  dateTo?: string | number | null
): Record<string, unknown> | null {
  const t = (type ?? 'equals').toLowerCase();
  const from = dateFrom !== undefined && dateFrom !== null && dateFrom !== '' ? new Date(dateFrom) : null;
  const to = dateTo !== undefined && dateTo !== null && dateTo !== '' ? new Date(dateTo) : null;

  if (t === 'inrange' && from && to) {
    return { [field]: { $gte: from, $lte: to } };
  }
  if (from && !Number.isNaN(from.getTime())) {
    switch (t) {
      case 'greaterthan':
      case 'greaterThan':
        return { [field]: { $gt: from } };
      case 'lessthan':
      case 'lessThan':
        return { [field]: { $lt: from } };
      default:
        return { [field]: from };
    }
  }
  return null;
}

/**
 * Converts a map of colId -> AG Grid filter model into a MongoDB $and of conditions.
 */
export function buildMongoFilterFromColumnFilters(
  filterMap: Record<string, ColumnFilterPayload | unknown>
): Record<string, unknown> | undefined {
  const and: Record<string, unknown>[] = [];

  for (const [field, raw] of Object.entries(filterMap)) {
    if (!isSafeFieldPath(field)) {
      logger.warn(`Skipped invalid filter field path: ${field}`);
      continue;
    }

    if (typeof raw === 'string' || typeof raw === 'number') {
      const cond =
        typeof raw === 'number'
          ? buildNumberCondition(field, 'equals', raw)
          : buildTextCondition(field, 'contains', raw);
      if (cond) and.push(cond);
      continue;
    }

    if (!raw || typeof raw !== 'object') continue;

    const model = raw as ColumnFilterPayload;
    const filterType = (model.filterType ?? 'text').toLowerCase();

    let cond: Record<string, unknown> | null = null;

    if (filterType === 'text') {
      cond = buildTextCondition(field, model.type, model.filter as string | number | null);
    } else if (filterType === 'number') {
      cond = buildNumberCondition(field, model.type, model.filter as string | number | null);
    } else if (filterType === 'date') {
      cond = buildDateCondition(
        field,
        model.type,
        model.dateFrom ?? (model.filter as string | null),
        model.dateTo ?? model.filterTo
      );
    } else {
      // Unknown: try text on `filter` if present
      if (model.filter !== undefined && model.filter !== null && model.filter !== '') {
        cond = buildTextCondition(field, 'contains', model.filter as string | number);
      }
    }

    if (cond && Object.keys(cond).length > 0) {
      and.push(cond);
    }
  }

  if (and.length === 0) return undefined;
  if (and.length === 1) return and[0] ?? undefined;
  return { $and: and };
}

/** Regex search paths per collection (no text index required) */
const SEARCH_PATHS: Record<string, string[]> = {
  tickets: ['recordId', 'baseId', 'tableId'],
  revision_history: ['uuid', 'issueId', 'authoredBy', 'oldValue', 'newValue', 'columnType'],
  bases: ['baseId', 'name', 'permissionLevel'],
  tables: ['tableId', 'baseId', 'name', 'primaryFieldId'],
  users: ['userId', 'email', 'name'],
};

export function buildKeywordSearchCondition(
  collection: string,
  term: string
): Record<string, unknown> | undefined {
  const trimmed = term.trim();
  if (!trimmed) return undefined;

  const paths = SEARCH_PATHS[collection];
  if (!paths?.length) return undefined;

  const regex = escapeRegex(trimmed);
  const or: Record<string, unknown>[] = paths.map((p) => ({
    [p]: { $regex: regex, $options: 'i' },
  }));

  if (collection === 'tickets') {
    or.push({
      $expr: {
        $gt: [
          {
            $size: {
              $filter: {
                input: { $objectToArray: { $ifNull: ['$fields', {}] } },
                as: 'pair',
                cond: {
                  $regexMatch: {
                    input: { $toString: '$$pair.v' },
                    regex: regex,
                    options: 'i',
                  },
                },
              },
            },
          },
          0,
        ],
      },
    });
  }

  return { $or: or };
}
