import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import { ApiResponse, CollectionInfo, CollectionSchema, PaginatedResponse } from '../models/api-response.model';
import { Base } from '../models/ticket.model';
import { SyncStatus } from '../models/revision.model';

export interface GridQueryParams {
  page?: number;
  limit?: number;
  sortField?: string;
  sortOrder?: 'asc' | 'desc';
  search?: string;
  filter?: string;
}

export interface WorkspaceUser {
  id: string;
  email?: string;
  name?: string;
  bases: { baseId: string; permissionLevel?: string }[];
}

@Injectable({ providedIn: 'root' })
export class AirtableDataService {
  private readonly api = inject(ApiService);

  // ── Airtable meta ─────────────────────────────────────────────────────────

  startSync(): Observable<ApiResponse<{ startedAt: string }>> {
    return this.api.post<ApiResponse<{ startedAt: string }>>('/airtable/sync');
  }

  getSyncStatus(): Observable<ApiResponse<SyncStatus>> {
    return this.api.get<ApiResponse<SyncStatus>>('/airtable/sync/status');
  }

  getBases(): Observable<ApiResponse<Base[]>> {
    return this.api.get<ApiResponse<Base[]>>('/airtable/bases');
  }

  /** Live from Airtable API: unique collaborators across accessible bases. */
  getWorkspaceUsers(): Observable<ApiResponse<WorkspaceUser[]>> {
    return this.api.get<ApiResponse<WorkspaceUser[]>>('/airtable/workspace/users');
  }

  // ── Data collections ──────────────────────────────────────────────────────

  getCollections(): Observable<ApiResponse<CollectionInfo[]>> {
    return this.api.get<ApiResponse<CollectionInfo[]>>('/data/collections');
  }

  getCollectionSchema(collection: string): Observable<ApiResponse<CollectionSchema>> {
    return this.api.get<ApiResponse<CollectionSchema>>(`/data/${collection}/schema`);
  }

  getCollectionData(
    collection: string,
    params: GridQueryParams = {}
  ): Observable<PaginatedResponse<Record<string, unknown>>> {
    const queryParams: Record<string, string | number | boolean> = {};
    if (params.page !== undefined) queryParams['page'] = params.page;
    if (params.limit !== undefined) queryParams['limit'] = params.limit;
    if (params.sortField) queryParams['sortField'] = params.sortField;
    if (params.sortOrder) queryParams['sortOrder'] = params.sortOrder;
    if (params.search) queryParams['search'] = params.search;
    if (params.filter) queryParams['filter'] = params.filter;

    return this.api.get<PaginatedResponse<Record<string, unknown>>>(
      `/data/${collection}`,
      queryParams
    );
  }

  // ── Scraping ──────────────────────────────────────────────────────────────

  startRevisionSync(): Observable<ApiResponse<{ startedAt: string }>> {
    return this.api.post<ApiResponse<{ startedAt: string }>>('/scraping/revisions/sync');
  }

  getRevisionSyncStatus(): Observable<ApiResponse<SyncStatus>> {
    return this.api.get<ApiResponse<SyncStatus>>('/scraping/revisions/status');
  }
}
