import * as cheerio from 'cheerio';
import { logger } from './logger';

export interface ParsedRevisionEntry {
  uuid: string;
  issueId: string;
  columnType: 'assignee' | 'status';
  oldValue: string | null;
  newValue: string | null;
  createdDate: Date;
  authoredBy: string;
}

interface AirtableActivityInfo {
  createdTime: string;
  originatingUserId: string;
  diffRowHtml: string;
  groupType: string;
}

interface AirtableRevisionResponse {
  msg: string;
  data: {
    orderedActivityAndCommentIds: string[];
    rowActivityInfoById: Record<string, AirtableActivityInfo>;
    rowActivityOrCommentUserObjById?: Record<
      string,
      { id: string; email: string; name: string }
    >;
    [key: string]: unknown;
  };
}

const COLUMN_ALIASES: Record<string, 'assignee' | 'status'> = {
  status: 'status',
  'assigned to': 'assignee',
  assignee: 'assignee',
  assignees: 'assignee',
  owner: 'assignee',
};

/**
 * Parses the JSON response from Airtable's readRowActivitiesAndComments endpoint.
 *
 * Response shape:
 * {
 *   msg: "SUCCESS",
 *   data: {
 *     rowActivityInfoById: {
 *       "<activityId>": {
 *         createdTime, originatingUserId, diffRowHtml, groupType
 *       }
 *     }
 *   }
 * }
 *
 * diffRowHtml contains the change details as HTML that must be parsed with cheerio.
 */
export function parseRevisionResponse(
  raw: string,
  ticketId: string
): ParsedRevisionEntry[] {
  const entries: ParsedRevisionEntry[] = [];

  try {
    const json: AirtableRevisionResponse =
      typeof raw === 'string' ? JSON.parse(raw) : raw;

    if (json.msg !== 'SUCCESS' || !json.data?.rowActivityInfoById) {
      logger.warn('Unexpected revision response format', {
        ticketId,
        msg: json.msg,
        hasData: !!json.data,
      });
      return entries;
    }

    const activityMap = json.data.rowActivityInfoById;

    for (const [activityId, info] of Object.entries(activityMap)) {
      if (!info.diffRowHtml) continue;

      const parsed = parseDiffRowHtml(activityId, info, ticketId);
      if (parsed) {
        entries.push(parsed);
      }
    }
  } catch (error) {
    logger.warn('Failed to parse revision response', { ticketId, error });
  }

  return entries;
}

/**
 * Parses one activity's diffRowHtml to extract column type, old value, and new value.
 *
 * HTML structure (from real Airtable responses):
 *
 *   <div class="historicalCellContainer">
 *     <div class="micro strong caps ..." columnId="fldXXX">Status</div>
 *     <div class="historicalCellValueContainer" ...>
 *       <div class="historicalCellValue diff" data-columntype="...">
 *         <!-- value items with Plus/Minus SVG icons or "removed" class -->
 *       </div>
 *     </div>
 *   </div>
 *
 * Added values:   SVG href contains "#Plus"
 * Removed values: SVG href contains "#Minus", or class "removed", or style "line-through"
 */
function parseDiffRowHtml(
  activityId: string,
  info: AirtableActivityInfo,
  ticketId: string
): ParsedRevisionEntry | null {
  try {
    const $ = cheerio.load(info.diffRowHtml);

    const columnNameEl = $('.historicalCellContainer').children().first();
    const columnName = columnNameEl.text().trim().toLowerCase();

    const columnType = COLUMN_ALIASES[columnName];
    if (!columnType) return null;

    const addedValues: string[] = [];
    const removedValues: string[] = [];

    const diffContainer = $('.historicalCellValue.diff');

    diffContainer.find('.inline-block.relative').each((_, wrapper) => {
      const el = $(wrapper);
      const title =
        el.find('[title]').attr('title') ??
        el.find('.truncate-pre, .truncate').first().text().trim();

      if (!title) return;

      const svgUse = el.find('use[href], use[xlink\\:href]');
      const href =
        svgUse.attr('href') ?? svgUse.attr('xlink:href') ?? '';

      if (href.includes('Minus')) {
        removedValues.push(title);
      } else if (href.includes('Plus')) {
        addedValues.push(title);
      }
    });

    diffContainer.find('.foreignRecord').each((_, el) => {
      const rec = $(el);
      const title = rec.attr('title') ?? rec.text().trim();
      if (!title) return;

      if (
        rec.hasClass('removed') ||
        (rec.attr('style') ?? '').includes('line-through')
      ) {
        removedValues.push(title);
      } else {
        addedValues.push(title);
      }
    });

    if (addedValues.length === 0 && removedValues.length === 0) {
      const allTitles = diffContainer.find('[title]');
      allTitles.each((_, el) => {
        const t = $(el).attr('title');
        if (t) addedValues.push(t);
      });
    }

    return {
      uuid: activityId,
      issueId: ticketId,
      columnType,
      oldValue: removedValues.join(', ') || null,
      newValue: addedValues.join(', ') || null,
      createdDate: new Date(info.createdTime),
      authoredBy: info.originatingUserId ?? '',
    };
  } catch (error) {
    logger.warn('Failed to parse diffRowHtml', { activityId, ticketId, error });
    return null;
  }
}
