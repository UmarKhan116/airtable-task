import { airtableApiService } from './airtable-api.service';
import { BaseModel } from '../models/base.model';
import { TableModel } from '../models/table.model';
import { TicketModel } from '../models/ticket.model';
import { UserModel } from '../models/user.model';
import { logger } from '../utils/logger';

export interface SyncResult {
  bases: number;
  tables: number;
  tickets: number;
  users: number;
  errors: string[];
}

export interface SyncStatus {
  isRunning: boolean;
  progress?: {
    currentBase?: string;
    currentTable?: string;
    ticketsFetched: number;
  };
  lastResult?: SyncResult;
  startedAt?: Date;
  completedAt?: Date;
}

class SyncState {
  isRunning = false;
  progress = { currentBase: '', currentTable: '', ticketsFetched: 0 };
  lastResult: SyncResult | undefined;
  startedAt: Date | undefined;
  completedAt: Date | undefined;
}

const syncState = new SyncState();

export class AirtableSyncService {
  getStatus(): SyncStatus {
    return {
      isRunning: syncState.isRunning,
      progress: syncState.isRunning ? { ...syncState.progress } : undefined,
      lastResult: syncState.lastResult,
      startedAt: syncState.startedAt,
      completedAt: syncState.completedAt,
    };
  }

  async syncAll(): Promise<SyncResult> {
    if (syncState.isRunning) {
      return (
        syncState.lastResult ?? {
          bases: 0,
          tables: 0,
          tickets: 0,
          users: 0,
          errors: ['Sync already running'],
        }
      );
    }

    syncState.isRunning = true;
    syncState.startedAt = new Date();
    syncState.progress = { currentBase: '', currentTable: '', ticketsFetched: 0 };
    syncState.lastResult = undefined;

    const result: SyncResult = { bases: 0, tables: 0, tickets: 0, users: 0, errors: [] };

    try {
      logger.info('Starting full Airtable sync');

      // ── Fetch and upsert bases ──────────────────────────────────────────────
      const bases = await airtableApiService.fetchAllBases();
      result.bases = bases.length;

      await Promise.all(
        bases.map((base) =>
          BaseModel.findOneAndUpdate(
            { baseId: base.id },
            {
              baseId: base.id,
              name: base.name,
              permissionLevel: base.permissionLevel,
              syncedAt: new Date(),
            },
            { upsert: true, new: true }
          )
        )
      );

      logger.info(`Synced ${bases.length} bases`);

      // ── Fetch tables and tickets for each base ─────────────────────────────
      for (const base of bases) {
        syncState.progress.currentBase = base.name;

        try {
          const tables = await airtableApiService.fetchTablesForBase(base.id);
          result.tables += tables.length;

          // Upsert tables
          await Promise.all(
            tables.map((table) =>
              TableModel.findOneAndUpdate(
                { baseId: base.id, tableId: table.id },
                {
                  tableId: table.id,
                  baseId: base.id,
                  name: table.name,
                  description: table.description,
                  primaryFieldId: table.primaryFieldId,
                  fields: table.fields,
                  views: table.views,
                  syncedAt: new Date(),
                },
                { upsert: true, new: true }
              )
            )
          );

          // Fetch records for each table
          for (const table of tables) {
            syncState.progress.currentTable = table.name;

            try {
              const records = await airtableApiService.fetchAllRecordsForTable(
                base.id,
                table.id,
                (fetched) => {
                  syncState.progress.ticketsFetched = result.tickets + fetched;
                }
              );

              // Bulk upsert records
              if (records.length > 0) {
                const bulkOps = records.map((record) => ({
                  updateOne: {
                    filter: { baseId: base.id, tableId: table.id, recordId: record.id },
                    update: {
                      $set: {
                        recordId: record.id,
                        baseId: base.id,
                        tableId: table.id,
                        fields: record.fields,
                        createdTime: record.createdTime ? new Date(record.createdTime) : undefined,
                        syncedAt: new Date(),
                      },
                    },
                    upsert: true,
                  },
                }));

                await TicketModel.bulkWrite(bulkOps, { ordered: false });
                result.tickets += records.length;
              }

              logger.info(
                `Synced ${records.length} records for table "${table.name}" in base "${base.name}"`
              );
            } catch (tableError) {
              const msg = `Failed to sync table ${table.name} in base ${base.name}: ${tableError}`;
              logger.error(msg);
              result.errors.push(msg);
            }
          }
        } catch (baseError) {
          const msg = `Failed to sync base ${base.name}: ${baseError}`;
          logger.error(msg);
          result.errors.push(msg);
        }
      }

      // ── Workspace collaborators → users collection ─────────────────────────
      try {
        const workspaceUsers = await airtableApiService.fetchWorkspaceUsers(bases);
        if (workspaceUsers.length > 0) {
          const bulkOps = workspaceUsers.map((u) => ({
            updateOne: {
              filter: { userId: u.id },
              update: {
                $set: {
                  userId: u.id,
                  email: u.email,
                  name: u.name,
                  bases: u.bases,
                  syncedAt: new Date(),
                },
              },
              upsert: true,
            },
          }));
          await UserModel.bulkWrite(bulkOps, { ordered: false });
        }
        result.users = workspaceUsers.length;
        logger.info(`Synced ${workspaceUsers.length} workspace users`);
      } catch (userError) {
        const msg = `Failed to sync workspace users: ${userError}`;
        logger.error(msg);
        result.errors.push(msg);
      }

      syncState.lastResult = result;
      syncState.completedAt = new Date();
      logger.info('Full Airtable sync completed', result);
      return result;
    } catch (error) {
      const msg = `Sync failed: ${error}`;
      result.errors.push(msg);
      logger.error(msg);
      syncState.lastResult = result;
      syncState.completedAt = new Date();
      return result;
    } finally {
      syncState.isRunning = false;
    }
  }
}

export const airtableSyncService = new AirtableSyncService();
