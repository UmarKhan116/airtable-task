import axios, { AxiosInstance } from 'axios';
import { oauthService } from './oauth.service';
import { AIRTABLE_CONFIG } from '../config/airtable';
import { logger } from '../utils/logger';
import { AppError } from '../middleware/error.middleware';

export interface AirtableBase {
  id: string;
  name: string;
  permissionLevel: string;
}

export interface AirtableField {
  id: string;
  name: string;
  type: string;
  description?: string;
  options?: Record<string, unknown>;
}

export interface AirtableView {
  id: string;
  name: string;
  type: string;
}

export interface AirtableTable {
  id: string;
  name: string;
  description?: string;
  primaryFieldId: string;
  fields: AirtableField[];
  views: AirtableView[];
}

export interface AirtableRecord {
  id: string;
  createdTime: string;
  fields: Record<string, unknown>;
}

export interface AirtableRecordsPage {
  records: AirtableRecord[];
  offset?: string;
}

/** User inferred from base collaborator endpoints (union across all bases the token can access). */
export interface WorkspaceUser {
  id: string;
  email?: string;
  name?: string;
  bases: { baseId: string; permissionLevel?: string }[];
}

export class AirtableApiService {
  private async createClient(): Promise<AxiosInstance> {
    const accessToken = await oauthService.getValidAccessToken();

    return axios.create({
      baseURL: AIRTABLE_CONFIG.BASE_URL,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 30_000,
    });
  }

  private async withRetry<T>(
    fn: () => Promise<T>,
    retries = AIRTABLE_CONFIG.PAGINATION.MAX_RETRIES
  ): Promise<T> {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        if (axios.isAxiosError(error)) {
          const status = error.response?.status;

          // Rate limit — wait and retry
          if (status === 429) {
            const retryAfter = Number(error.response?.headers['retry-after'] ?? 30) * 1000;
            logger.warn(`Rate limited, retrying after ${retryAfter}ms`, { attempt });
            await this.sleep(retryAfter);
            continue;
          }

          // Auth error — try to refresh token once
          if (status === 401 && attempt === 1) {
            logger.warn('Access token expired, refreshing...');
            await oauthService.refreshAccessToken();
            continue;
          }

          if (attempt === retries) {
            throw new AppError(
              `Airtable API error: ${error.response?.data?.error?.message ?? error.message}`,
              status ?? 500
            );
          }
        }

        if (attempt === retries) throw error;

        await this.sleep(AIRTABLE_CONFIG.PAGINATION.RETRY_DELAY_MS * attempt);
      }
    }
    throw new AppError('Max retries exceeded', 500);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async fetchAllBases(): Promise<AirtableBase[]> {
    const client = await this.createClient();
    const bases: AirtableBase[] = [];
    let offset: string | undefined;

    do {
      const params: Record<string, string> = {};
      if (offset) params['offset'] = offset;

      const response = await this.withRetry(() =>
        client.get<{ bases: AirtableBase[]; offset?: string }>('/meta/bases', { params })
      );

      bases.push(...response.data.bases);
      offset = response.data.offset;

      if (offset) await this.sleep(200);
    } while (offset);

    logger.info(`Fetched ${bases.length} bases from Airtable`);
    return bases;
  }

  async fetchTablesForBase(baseId: string): Promise<AirtableTable[]> {
    const client = await this.createClient();

    const response = await this.withRetry(() =>
      client.get<{ tables: AirtableTable[] }>(`/meta/bases/${baseId}/tables`)
    );

    logger.info(`Fetched ${response.data.tables.length} tables for base ${baseId}`);
    return response.data.tables;
  }

  async fetchAllRecordsForTable(
    baseId: string,
    tableId: string,
    onProgress?: (fetched: number) => void
  ): Promise<AirtableRecord[]> {
    const client = await this.createClient();
    const records: AirtableRecord[] = [];
    let offset: string | undefined;

    do {
      const params: Record<string, string | number> = {
        pageSize: AIRTABLE_CONFIG.PAGINATION.PAGE_SIZE,
      };
      if (offset) params['offset'] = offset;

      const response = await this.withRetry(() =>
        client.get<AirtableRecordsPage>(`/${baseId}/${tableId}`, { params })
      );

      records.push(...response.data.records);
      offset = response.data.offset;

      if (onProgress) onProgress(records.length);
      if (offset) await this.sleep(200);
    } while (offset);

    logger.info(
      `Fetched ${records.length} records for table ${tableId} in base ${baseId}`
    );
    return records;
  }

  /**
   * De-duplicated users across the workspace (GET /v0/meta/bases/{baseId}/collaborators per base).
   * @param bases Optional pre-fetched bases to skip an extra list-bases call during sync.
   * @see https://airtable.com/developers/web/api/get-base-collaborators
   */
  async fetchWorkspaceUsers(bases?: AirtableBase[]): Promise<WorkspaceUser[]> {
    const baseList = bases ?? (await this.fetchAllBases());
    const client = await this.createClient();
    const byId = new Map<string, WorkspaceUser>();

    for (const base of baseList) {
      try {
        const { data } = await this.withRetry(() =>
          client.get<unknown>(`/meta/bases/${base.id}/collaborators`)
        );

        for (const row of this.flattenCollaboratorEntries(data)) {
          const id = row.userId;
          if (!id) continue;

          const access = { baseId: base.id, permissionLevel: row.permissionLevel };
          const existing = byId.get(id);
          if (!existing) {
            byId.set(id, {
              id,
              email: row.email,
              name: row.name,
              bases: [access],
            });
          } else {
            existing.bases.push(access);
            if (!existing.email && row.email) existing.email = row.email;
            if (!existing.name && row.name) existing.name = row.name;
          }
        }
      } catch (error) {
        logger.warn(`Failed to fetch collaborators for base ${base.id}`, { error });
      }

      await this.sleep(150);
    }

    const users = Array.from(byId.values());
    logger.info(`Resolved ${users.length} unique workspace users from ${baseList.length} bases`);
    return users;
  }

  /** Accepts various collaborator payload shapes returned by the Metadata API. */
  private flattenCollaboratorEntries(payload: unknown): Array<{
    userId: string;
    email?: string;
    name?: string;
    permissionLevel?: string;
  }> {
    const out: Array<{
      userId: string;
      email?: string;
      name?: string;
      permissionLevel?: string;
    }> = [];

    const visit = (node: unknown): void => {
      if (node === null || node === undefined) return;
      if (Array.isArray(node)) {
        for (const item of node) visit(item);
        return;
      }
      if (typeof node !== 'object') return;

      const o = node as Record<string, unknown>;

      const userId = pickUserId(o);
      if (userId) {
        out.push({
          userId,
          email: typeof o['email'] === 'string' ? o['email'] : undefined,
          name: typeof o['name'] === 'string' ? o['name'] : undefined,
          permissionLevel:
            typeof o['permissionLevel'] === 'string' ? o['permissionLevel'] : undefined,
        });
        return;
      }

      for (const v of Object.values(o)) visit(v);
    };

    visit(payload);
    return dedupeRowsByUserId(out);
  }
}

function pickUserId(o: Record<string, unknown>): string | null {
  const candidates = [o['userId'], o['id'], o['user']];
  for (const c of candidates) {
    if (typeof c === 'string' && c.startsWith('usr')) return c;
    if (typeof c === 'string' && c.length > 0) return c;
  }
  return null;
}

function dedupeRowsByUserId(
  rows: Array<{ userId: string; email?: string; name?: string; permissionLevel?: string }>
): Array<{ userId: string; email?: string; name?: string; permissionLevel?: string }> {
  const map = new Map<string, { userId: string; email?: string; name?: string; permissionLevel?: string }>();
  for (const r of rows) {
    if (!map.has(r.userId)) map.set(r.userId, { ...r });
  }
  return Array.from(map.values());
}

export const airtableApiService = new AirtableApiService();
