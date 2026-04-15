import axios from 'axios';
import { randomUUID } from 'crypto';
import { cookieService } from './cookie.service';
import { RevisionModel } from '../models/revision.model';
import { TicketModel } from '../models/ticket.model';
import { AIRTABLE_CONFIG } from '../config/airtable';
import { parseRevisionResponse } from '../utils/html-parser';
import { logger } from '../utils/logger';
import { ICookie } from '../models/airtable-session.model';

export interface RevisionSyncResult {
  ticketsProcessed: number;
  revisionsFound: number;
  revisionsUpserted: number;
  errors: string[];
}

export interface RevisionSyncStatus {
  isRunning: boolean;
  progress?: {
    current: number;
    total: number;
    currentTicketId?: string;
  };
  lastResult?: RevisionSyncResult;
  startedAt?: Date;
  completedAt?: Date;
}

class RevisionSyncState {
  isRunning = false;
  progress = { current: 0, total: 0, currentTicketId: '' };
  lastResult: RevisionSyncResult | undefined;
  startedAt: Date | undefined;
  completedAt: Date | undefined;
}

const revisionSyncState = new RevisionSyncState();

export class ScrapingService {
  getStatus(): RevisionSyncStatus {
    return {
      isRunning: revisionSyncState.isRunning,
      progress: revisionSyncState.isRunning ? { ...revisionSyncState.progress } : undefined,
      lastResult: revisionSyncState.lastResult,
      startedAt: revisionSyncState.startedAt,
      completedAt: revisionSyncState.completedAt,
    };
  }

  async syncAllRevisions(): Promise<RevisionSyncResult> {
    if (revisionSyncState.isRunning) {
      return (
        revisionSyncState.lastResult ?? {
          ticketsProcessed: 0,
          revisionsFound: 0,
          revisionsUpserted: 0,
          errors: ['Revision sync already running'],
        }
      );
    }

    revisionSyncState.isRunning = true;
    revisionSyncState.startedAt = new Date();
    revisionSyncState.progress = { current: 0, total: 0, currentTicketId: '' };
    revisionSyncState.lastResult = undefined;

    const result: RevisionSyncResult = {
      ticketsProcessed: 0,
      revisionsFound: 0,
      revisionsUpserted: 0,
      errors: [],
    };

    try {
      const tickets = await TicketModel.find(
        {},
        { recordId: 1, baseId: 1, tableId: 1, _id: 0 }
      ).lean();

      revisionSyncState.progress.total = tickets.length;
      logger.info(`Starting revision sync for ${tickets.length} tickets`);

      const batchSize = AIRTABLE_CONFIG.SCRAPING.BATCH_SIZE;

      for (let i = 0; i < tickets.length; i += batchSize) {
        const batch = tickets.slice(i, i + batchSize);

        await Promise.all(
          batch.map(async (ticket) => {
            try {
              await this.fetchAndStoreRevisions(
                ticket.recordId,
                ticket.baseId,
                ticket.tableId,
                result
              );
              revisionSyncState.progress.current++;
              revisionSyncState.progress.currentTicketId = ticket.recordId;
            } catch (error) {
              const msg = `Failed to fetch revisions for ticket ${ticket.recordId}: ${error}`;
              result.errors.push(msg);
              logger.warn(msg);
            }
          })
        );

        result.ticketsProcessed += batch.length;

        if (i + batchSize < tickets.length) {
          await this.sleep(AIRTABLE_CONFIG.SCRAPING.REQUEST_DELAY_MS);
        }
      }

      revisionSyncState.lastResult = result;
      revisionSyncState.completedAt = new Date();

      logger.info('Revision sync completed', result);
      return result;
    } catch (error) {
      const msg = `Revision sync failed: ${error}`;
      result.errors.push(msg);
      logger.error(msg);
      revisionSyncState.lastResult = result;
      revisionSyncState.completedAt = new Date();
      return result;
    } finally {
      revisionSyncState.isRunning = false;
    }
  }

  async fetchAndStoreRevisions(
    recordId: string,
    baseId: string,
    tableId: string,
    result: RevisionSyncResult
  ): Promise<void> {
    const cookies = await cookieService.getValidCookies();
    const responseData = await this.callRevisionEndpoint(
      recordId,
      baseId,
      tableId,
      cookies
    );

    const entries = parseRevisionResponse(responseData, recordId);
    result.revisionsFound += entries.length;

    if (entries.length === 0) return;

    const bulkOps = entries.map((entry) => ({
      updateOne: {
        filter: { uuid: entry.uuid },
        update: {
          $set: {
            uuid: entry.uuid,
            issueId: entry.issueId,
            columnType: entry.columnType,
            oldValue: entry.oldValue,
            newValue: entry.newValue,
            createdDate: entry.createdDate,
            authoredBy: entry.authoredBy,
          },
        },
        upsert: true,
      },
    }));

    const bulkResult = await RevisionModel.bulkWrite(bulkOps, { ordered: false });
    result.revisionsUpserted += (bulkResult.upsertedCount ?? 0) + (bulkResult.modifiedCount ?? 0);

    await TicketModel.updateOne(
      { recordId },
      { $set: { revisionSyncedAt: new Date() } }
    );
  }

  /**
   * GET https://airtable.com/v0.3/row/{recordId}/readRowActivitiesAndComments
   *
   * Query params (from Airtable network tab):
   *   stringifiedObjectParams — JSON: { limit, offsetV2, ... }
   *   requestId               — unique per request
   *
   * Required headers:
   *   x-airtable-application-id, x-airtable-inter-service-client,
   *   x-airtable-page-load-id, x-requested-with, x-time-zone, Cookie
   */
  private async callRevisionEndpoint(
    recordId: string,
    baseId: string,
    _tableId: string,
    cookies: ICookie[]
  ): Promise<string> {
    const cookieHeader = cookieService.formatCookieHeader(cookies);
    const csrfToken = this.extractCsrfToken(cookies);
    const pageLoadId = randomUUID();
    const requestId = `req${randomUUID().replace(/-/g, '').slice(0, 17)}`;

    const url = `https://airtable.com/v0.3/row/${recordId}/readRowActivitiesAndComments`;

    const headers: Record<string, string> = {
      Cookie: cookieHeader,
      Accept: 'application/json, text/html, */*',
      Referer: `https://airtable.com/${baseId}`,
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'x-airtable-application-id': baseId,
      'x-airtable-inter-service-client': 'webClient',
      'x-airtable-page-load-id': pageLoadId,
      'x-requested-with': 'XMLHttpRequest',
      'x-time-zone': Intl.DateTimeFormat().resolvedOptions().timeZone,
      'x-user-locale': 'en',
    };

    if (csrfToken) {
      headers['x-csrf-token'] = csrfToken;
    }

    const params = {
      stringifiedObjectParams: JSON.stringify({
        limit: 50,
        offsetV2: null,
        shouldReturnDeserializedActivityItems: true,
        shouldIncludeRowActivityOrCommentUserObjById: true,
      }),
      requestId,
    };

    try {
      const response = await axios.get(url, {
        headers,
        params,
        timeout: 20_000,
      });
      return typeof response.data === 'string'
        ? response.data
        : JSON.stringify(response.data);
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 401) {
        logger.warn('Cookies rejected by Airtable, invalidating session');
        await cookieService.invalidateSession();
      }
      throw error;
    }
  }

  private extractCsrfToken(cookies: ICookie[]): string | null {
    const csrf = cookies.find(
      (c) =>
        c.name.toLowerCase().includes('csrf') ||
        c.name === 'AIRTABLE_CSRF_TOKEN' ||
        c.name === '__Host-airtable-csrf-token'
    );
    return csrf?.value ?? null;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const scrapingService = new ScrapingService();
