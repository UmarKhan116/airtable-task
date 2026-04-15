import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { buildPaginationOptions, buildPaginationResult } from '../utils/pagination';
import {
  buildMongoFilterFromColumnFilters,
  buildKeywordSearchCondition,
  isSafeFieldPath,
} from '../utils/grid-filter';
import { AppError } from '../middleware/error.middleware';

// Collections allowed to be queried via the data API
const ALLOWED_COLLECTIONS = new Set([
  'tickets',
  'revision_history',
  'bases',
  'tables',
  'users',
]);

export class DataController {
  /**
   * GET /api/data/collections
   * Returns list of available MongoDB collection names with document counts.
   */
  async getCollections(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const db = mongoose.connection.db;
      if (!db) throw new AppError('Database not connected', 503);

      const allCollections = await db.listCollections().toArray();
      const countByName = new Map<string, number>();

      await Promise.all(
        allCollections
          .filter((c) => ALLOWED_COLLECTIONS.has(c.name))
          .map(async (col) => {
            const count = await db.collection(col.name).countDocuments();
            countByName.set(col.name, count);
          })
      );

      const collections = Array.from(ALLOWED_COLLECTIONS)
        .sort()
        .map((name) => ({ name, count: countByName.get(name) ?? 0 }));

      res.json({ success: true, data: collections });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/data/:collection
   * Returns paginated, filtered, and sorted data from a MongoDB collection.
   *
   * Query params:
   *   page          - page number (default: 1)
   *   limit         - page size (default: 100, max: 1000)
   *   sortField     - field to sort by (default: _id)
   *   sortOrder     - 'asc' | 'desc' (default: 'asc')
   *   search        - keyword search (regex across configured paths)
   *   filter        - JSON: map of colId -> AG Grid column filter model (or legacy string values)
   */
  async getCollectionData(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const collection = req.params['collection'] as string;

      if (!ALLOWED_COLLECTIONS.has(collection)) {
        throw new AppError(`Collection '${collection}' is not accessible`, 403);
      }

      const db = mongoose.connection.db;
      if (!db) throw new AppError('Database not connected', 503);

      const rawQuery = req.query as Record<string, string | string[]>;
      const query: Record<string, string> = {};
      for (const [k, v] of Object.entries(rawQuery)) {
        query[k] = Array.isArray(v) ? v[0] : v;
      }
      const options = buildPaginationOptions(query);

      const parts: Record<string, unknown>[] = [];

      if (query['filter'] && typeof query['filter'] === 'string') {
        try {
          const parsed = JSON.parse(query['filter']) as Record<string, unknown>;
          const columnCond = buildMongoFilterFromColumnFilters(parsed);
          if (columnCond) parts.push(columnCond);
        } catch {
          throw new AppError('Invalid filter JSON', 400);
        }
      }

      const searchTerm = query['search'];
      if (typeof searchTerm === 'string' && searchTerm.trim()) {
        const searchCond = buildKeywordSearchCondition(collection, searchTerm);
        if (searchCond) parts.push(searchCond);
      }

      let mongoFilter: Record<string, unknown> = {};
      if (parts.length === 1) {
        mongoFilter = parts[0] ?? {};
      } else if (parts.length > 1) {
        mongoFilter = { $and: parts };
      }

      const col = db.collection(collection);
      const skip = ((options.page ?? 1) - 1) * (options.limit ?? 100);
      const limit = options.limit ?? 100;

      let sortField = options.sortField ?? '_id';
      if (!isSafeFieldPath(sortField)) {
        sortField = '_id';
      }
      const sortDir = options.sortOrder === 'desc' ? -1 : 1;

      const [data, total] = await Promise.all([
        col
          .find(mongoFilter)
          .sort({ [sortField]: sortDir })
          .skip(skip)
          .limit(limit)
          .toArray(),
        col.countDocuments(mongoFilter),
      ]);

      const result = buildPaginationResult(data, total, options);

      res.json({ success: true, ...result });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/data/:collection/schema
   * Returns inferred column schema from the first N documents (for AG Grid column generation).
   */
  async getCollectionSchema(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const collection = req.params['collection'] as string;

      if (!ALLOWED_COLLECTIONS.has(collection)) {
        throw new AppError(`Collection '${collection}' is not accessible`, 403);
      }

      const db = mongoose.connection.db;
      if (!db) throw new AppError('Database not connected', 503);

      const sample = await db.collection(collection).find().limit(50).toArray();

      // Infer unique top-level field names and their types
      const fieldMap = new Map<string, Set<string>>();

      for (const doc of sample) {
        for (const [key, value] of Object.entries(doc)) {
          if (!fieldMap.has(key)) fieldMap.set(key, new Set());
          fieldMap.get(key)!.add(this.inferType(value));
        }
      }

      const schema = Array.from(fieldMap.entries()).map(([field, types]) => ({
        field,
        types: Array.from(types),
        primaryType: Array.from(types)[0] ?? 'string',
      }));

      // Flatten nested 'fields' object keys (Airtable ticket fields)
      const nestedFieldKeys = new Map<string, Set<string>>();
      for (const doc of sample) {
        const fld = doc['fields'];
        if (fld && typeof fld === 'object' && !Array.isArray(fld)) {
          for (const [k, v] of Object.entries(fld as Record<string, unknown>)) {
            if (!nestedFieldKeys.has(k)) nestedFieldKeys.set(k, new Set());
            nestedFieldKeys.get(k)!.add(this.inferType(v));
          }
        }
      }

      const flatFields = Array.from(nestedFieldKeys.entries()).map(([k, types]) => ({
        field: `fields.${k}`,
        types: Array.from(types),
        primaryType: Array.from(types)[0] ?? 'string',
      }));

      res.json({
        success: true,
        data: {
          collection,
          fields: [...schema, ...flatFields],
        },
      });
    } catch (error) {
      next(error);
    }
  }

  private inferType(value: unknown): string {
    if (value === null || value === undefined) return 'null';
    if (value instanceof Date) return 'date';
    if (Array.isArray(value)) return 'array';
    return typeof value;
  }
}

export const dataController = new DataController();
