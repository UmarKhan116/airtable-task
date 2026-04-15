import { Request, Response, NextFunction } from 'express';
import { airtableSyncService } from '../services/airtable-sync.service';
import { airtableApiService } from '../services/airtable-api.service';
import { BaseModel } from '../models/base.model';
import { TableModel } from '../models/table.model';

export class AirtableController {
  /**
   * POST /api/airtable/sync
   * Triggers a full sync of all bases, tables, and tickets from Airtable.
   */
  async startSync(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const status = airtableSyncService.getStatus();

      if (status.isRunning) {
        res.status(202).json({
          success: true,
          message: 'Sync already in progress',
          data: status,
        });
        return;
      }

      // Start sync asynchronously (non-blocking)
      airtableSyncService.syncAll().catch((err) => {
        // Errors are captured within syncAll; this is just a safety net
        console.error('Background sync error:', err);
      });

      res.status(202).json({
        success: true,
        message: 'Sync started',
        data: { startedAt: new Date() },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/airtable/sync/status
   * Returns the current sync status and last result.
   */
  getSyncStatus(req: Request, res: Response, next: NextFunction): void {
    try {
      const status = airtableSyncService.getStatus();
      res.json({ success: true, data: status });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/airtable/bases
   * Returns all synced bases from MongoDB.
   */
  async getBases(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const bases = await BaseModel.find().sort({ name: 1 }).lean();
      res.json({ success: true, data: bases });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/airtable/bases/:baseId/tables
   * Returns all synced tables for a given base.
   */
  async getTablesForBase(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { baseId } = req.params;
      const tables = await TableModel.find({ baseId }).sort({ name: 1 }).lean();
      res.json({ success: true, data: tables });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/airtable/workspace/users
   * Unique users across all bases the token can access (from meta collaborators).
   */
  async getWorkspaceUsers(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const users = await airtableApiService.fetchWorkspaceUsers();
      res.json({ success: true, data: users });
    } catch (error) {
      next(error);
    }
  }
}

export const airtableController = new AirtableController();
