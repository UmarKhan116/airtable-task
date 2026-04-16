import {
  Component,
  OnInit,
  OnDestroy,
  inject,
  signal,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, debounceTime, distinctUntilChanged, takeUntil, timer, take } from 'rxjs';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatChipsModule } from '@angular/material/chips';
import { MatBadgeModule } from '@angular/material/badge';

import { AgGridModule } from 'ag-grid-angular';
import {
  ColDef,
  GridApi,
  GridReadyEvent,
  SelectionChangedEvent,
  IDatasource,
  IGetRowsParams,
  GridOptions,
} from 'ag-grid-community';

import { AirtableDataService } from '../../core/services/airtable-data.service';
import { AuthService } from '../../core/services/auth.service';
import { CollectionInfo, CollectionSchema } from '../../core/models/api-response.model';
import { SessionStatus } from '../../core/models/auth.model';
import { MfaDialogComponent, MfaDialogData, MfaDialogResult } from '../mfa-dialog/mfa-dialog.component';

const INTEGRATIONS = [{ value: 'airtable', label: 'Airtable' }];

@Component({
  selector: 'app-raw-data',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FormsModule,
    MatToolbarModule,
    MatButtonModule,
    MatIconModule,
    MatSelectModule,
    MatFormFieldModule,
    MatInputModule,
    MatSnackBarModule,
    MatDialogModule,
    MatProgressBarModule,
    MatTooltipModule,
    MatChipsModule,
    MatBadgeModule,
    AgGridModule,
  ],
  templateUrl: './raw-data.component.html',
  styleUrls: ['./raw-data.component.scss'],
})
export class RawDataComponent implements OnInit, OnDestroy {
  private readonly dataService = inject(AirtableDataService);
  private readonly authService = inject(AuthService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly dialog = inject(MatDialog);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly destroy$ = new Subject<void>();
  private readonly searchSubject = new Subject<string>();

  private gridApi!: GridApi;

  readonly integrations = INTEGRATIONS;
  readonly selectedIntegration = signal('airtable');
  readonly collections = signal<CollectionInfo[]>([]);
  readonly selectedCollection = signal<string>('');
  readonly selectedProcessedEntity = signal<string>('');
  readonly searchText = signal('');
  readonly rowsSelected = signal(0);
  readonly isLoading = signal(false);
  readonly isSyncing = signal(false);
  readonly columnDefs = signal<ColDef[]>([]);
  readonly totalRows = signal(0);

  /** Airtable browser (Puppeteer) scraping session for revision history. */
  readonly scrapingSession = signal<SessionStatus | null>(null);
  readonly scrapingSessionLoading = signal(false);

  private previousScrapingBannerStatus: SessionStatus['status'] | null = null;

  readonly defaultColDef: ColDef = {
    sortable: true,
    filter: true,
    resizable: true,
    minWidth: 100,
    flex: 1,
  };

  /**
   * Infinite Row Model (Community): server-side sort, filter, and paging via getRows.
   */
  readonly gridOptions: GridOptions = {
    // Use CSS themes (ag-theme-alpine) loaded in styles.scss — v33 defaults to Quartz API otherwise.
    theme: 'legacy',
    rowModelType: 'infinite',
    cacheBlockSize: 100,
    maxBlocksInCache: 20,
    infiniteInitialRowCount: 1,
    rowBuffer: 5,
    getRowId: (params) => {
      const d = params.data as Record<string, unknown> | undefined;
      if (!d) return `empty-${Math.random().toString(36).slice(2)}`;
      const id = d['_id'];
      if (id && typeof id === 'object' && 'toString' in id) return String((id as { toString(): string }).toString());
      if (typeof id === 'string') return id;
      if (typeof d['recordId'] === 'string') return d['recordId'];
      if (typeof d['uuid'] === 'string') return d['uuid'];
      return JSON.stringify(d).slice(0, 200);
    },
    rowSelection: {
      mode: 'multiRow',
      checkboxes: true,
      headerCheckbox: true,
    },
    suppressRowClickSelection: true,
    animateRows: true,
    suppressMenuHide: false,
  };

  ngOnInit(): void {
    this.loadCollections();
    this.setupSearchDebounce();
    this.loadScrapingSessionStatus();
    timer(300_000, 300_000)
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => this.loadScrapingSessionStatus());
  }

  logout(): void {
    this.authService.logout().subscribe({
      error: (err) => {
        this.snackBar.open(err?.error?.message ?? 'Logout failed', 'Dismiss', { duration: 5000 });
      },
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  onGridReady(params: GridReadyEvent): void {
    this.gridApi = params.api;
    if (this.selectedCollection()) {
      this.setInfiniteDatasource();
    }
  }

  onSelectionChanged(event: SelectionChangedEvent): void {
    this.rowsSelected.set(event.api.getSelectedRows().length);
  }

  onIntegrationChange(value: string): void {
    this.selectedIntegration.set(value);
    this.loadCollections();
  }

  onCollectionChange(collection: string): void {
    this.selectedCollection.set(collection);
    this.selectedProcessedEntity.set('');
    this.rowsSelected.set(0);
    this.totalRows.set(0);
    this.loadCollectionSchema(collection);
  }

  onProcessedEntityChange(value: string): void {
    this.selectedProcessedEntity.set(value);
    if (value) this.onCollectionChange(value);
  }

  onSearchChange(value: string): void {
    this.searchText.set(value);
    this.searchSubject.next(value);
  }


  startSync(): void {
    this.isSyncing.set(true);
    this.dataService.startSync().subscribe({
      next: () => {
        this.snackBar.open('Airtable sync started', 'Dismiss', { duration: 3000 });
        this.pollSyncStatus();
      },
      error: (err) => {
        this.isSyncing.set(false);
        this.snackBar.open(err?.error?.message ?? 'Failed to start sync', 'Dismiss', {
          duration: 5000,
        });
      },
    });
  }

  startRevisionSync(): void {
    this.isSyncing.set(true);
    this.dataService.startRevisionSync().subscribe({
      next: () => {
        this.snackBar.open('Revision sync started', 'Dismiss', { duration: 3000 });
        this.pollRevisionSyncStatus();
      },
      error: (err) => {
        this.isSyncing.set(false);
        this.snackBar.open(err?.error?.message ?? 'Failed to start revision sync', 'Dismiss', {
          duration: 5000,
        });
      },
    });
  }

  initScrapingSession(): void {
    this.authService.initScrapingSession().subscribe({
      next: (res) => {
        if (res.data.requiresMfa && res.data.sessionId) {
          this.openMfaDialog(res.data.sessionId, res.data.mfaType ?? 'totp');
        } else {
          this.snackBar.open('Airtable scraping session established', 'Dismiss', {
            duration: 3000,
          });
          this.loadScrapingSessionStatus();
        }
      },
      error: (err) => {
        this.snackBar.open(err?.error?.message ?? 'Failed to init session', 'Dismiss', {
          duration: 5000,
        });
      },
    });
  }

  formatScrapingSessionDate(iso?: string): string {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
  }

  openMfaDialog(sessionId: string, mfaType: 'totp' | 'sms' | 'none'): void {
    const dialogRef = this.dialog.open<MfaDialogComponent, MfaDialogData, MfaDialogResult>(
      MfaDialogComponent,
      {
        width: '420px',
        maxWidth: '95vw',
        disableClose: true,
        panelClass: 'app-mfa-dialog',
        data: { sessionId, mfaType },
      }
    );

    dialogRef.afterClosed().subscribe((result) => {
      if (result?.success) {
        this.snackBar.open('Session established successfully!', 'Dismiss', { duration: 3000 });
        this.loadScrapingSessionStatus();
      }
    });
  }

  refreshGrid(): void {
    if (this.gridApi && this.selectedCollection()) {
      this.gridApi.refreshInfiniteCache();
    }
  }

  private loadScrapingSessionStatus(): void {
    this.scrapingSessionLoading.set(true);
    this.authService.getSessionStatus().subscribe({
      next: (res) => {
        this.applyScrapingSessionStatus(res.data);
        this.scrapingSessionLoading.set(false);
        this.cdr.markForCheck();
      },
      error: () => {
        this.scrapingSessionLoading.set(false);
        if (!this.scrapingSession()) {
          this.scrapingSession.set({ status: 'none', isActive: false });
        }
        this.cdr.markForCheck();
      },
    });
  }

  private applyScrapingSessionStatus(data: SessionStatus): void {
    const next = data.status ?? (data.isActive ? 'active' : data.extractedAt ? 'expired' : 'none');
    const prev = this.previousScrapingBannerStatus;
    if (next === 'expired' && prev !== 'expired') {
      this.showExpiredScrapingSessionToast();
    }
    this.previousScrapingBannerStatus = next;
    this.scrapingSession.set({ ...data, status: next });
  }

  private showExpiredScrapingSessionToast(): void {
    const ref = this.snackBar.open(
      'Airtable scraping session expired. Renew to continue revision history sync.',
      'Renew',
      { duration: 14_000 }
    );
    ref.onAction().pipe(take(1)).subscribe(() => this.initScrapingSession());
  }

  private loadCollections(): void {
    this.dataService.getCollections().subscribe({
      next: (res) => {
        this.collections.set(res.data ?? []);
        this.cdr.markForCheck();
      },
      error: () => {
        this.collections.set([]);
        this.cdr.markForCheck();
      },
    });
  }

  private loadCollectionSchema(collection: string): void {
    this.isLoading.set(true);
    this.dataService.getCollectionSchema(collection).subscribe({
      next: (res) => {
        const schema = res.data;
        const cols = this.buildColumnDefs(schema);
        this.columnDefs.set(cols);

        if (this.gridApi) {
          this.gridApi.setGridOption('columnDefs', cols);
          this.gridApi.purgeInfiniteCache();
          this.setInfiniteDatasource();
        }
        this.isLoading.set(false);
        this.cdr.markForCheck();
      },
      error: () => {
        this.isLoading.set(false);
        this.snackBar.open('Failed to load collection schema', 'Dismiss', { duration: 3000 });
        this.cdr.markForCheck();
      },
    });
  }

  private buildColumnDefs(schema: CollectionSchema): ColDef[] {
    if (!schema?.fields?.length) return [];

    const priorityFields = ['recordId', 'issueId', 'uuid', '_id', 'name', 'columnType'];
    const sorted = [...schema.fields].sort((a, b) => {
      const aIdx = priorityFields.indexOf(a.field);
      const bIdx = priorityFields.indexOf(b.field);
      if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
      if (aIdx !== -1) return -1;
      if (bIdx !== -1) return 1;
      return a.field.localeCompare(b.field);
    });

    return sorted.map((fieldDef) => {
      const colDef: ColDef = {
        field: fieldDef.field,
        headerName: this.formatHeaderName(fieldDef.field),
        sortable: true,
        filter: this.getFilterType(fieldDef.primaryType),
        resizable: true,
        minWidth: 100,
      };

      if (fieldDef.primaryType === 'date') {
        colDef.valueFormatter = (params) =>
          params.value ? new Date(params.value as string | number).toLocaleString() : '';
      }

      if (fieldDef.primaryType === 'object' || fieldDef.primaryType === 'array') {
        colDef.valueFormatter = (params) =>
          params.value ? JSON.stringify(params.value) : '';
      }

      if (fieldDef.field === '_id' || fieldDef.field === 'recordId') {
        colDef.width = 180;
        colDef.flex = 0;
        colDef.suppressSizeToFit = true;
      }

      return colDef;
    });
  }

  private getFilterType(type: string): string {
    switch (type) {
      case 'number':
        return 'agNumberColumnFilter';
      case 'date':
        return 'agDateColumnFilter';
      default:
        return 'agTextColumnFilter';
    }
  }

  private formatHeaderName(field: string): string {
    const name = field.startsWith('fields.') ? field.substring(7) : field;
    return name
      .replace(/_/g, ' ')
      .replace(/([A-Z])/g, ' $1')
      .replace(/^\w/, (c) => c.toUpperCase())
      .trim();
  }

  private setInfiniteDatasource(): void {
    const collection = this.selectedCollection();
    if (!collection || !this.gridApi) return;

    const datasource: IDatasource = {
      getRows: (params: IGetRowsParams) => {
        const { startRow, endRow, sortModel, filterModel } = params;
        const pageSize = Math.max(1, endRow - startRow);
        const page = Math.floor(startRow / pageSize) + 1;

        const sortField = sortModel?.[0]?.colId;
        const sortOrder = sortModel?.[0]?.sort as 'asc' | 'desc' | undefined;

        const filterPayload =
          filterModel && Object.keys(filterModel).length > 0
            ? JSON.stringify(this.agGridFilterToApiPayload(filterModel))
            : undefined;

        this.dataService
          .getCollectionData(collection, {
            page,
            limit: pageSize,
            sortField,
            sortOrder,
            search: this.searchText().trim() || undefined,
            filter: filterPayload,
          })
          .subscribe({
            next: (res) => {
              this.totalRows.set(res.total);
              this.cdr.markForCheck();
              const lastRow = res.total;
              params.successCallback(res.data as Record<string, unknown>[], lastRow);
            },
            error: (err) => {
              console.error('Grid data error:', err);
              params.failCallback();
            },
          });
      },
    };

    this.gridApi.setGridOption('datasource', datasource);
  }

  /**
   * Normalizes AG Grid filterModel into a JSON object the API can turn into MongoDB queries.
   */
  private agGridFilterToApiPayload(filterModel: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};

    for (const [colId, raw] of Object.entries(filterModel)) {
      if (raw === null || raw === undefined) continue;

      if (typeof raw === 'string' || typeof raw === 'number') {
        out[colId] = { filterType: 'text', type: 'contains', filter: String(raw) };
        continue;
      }

      if (typeof raw !== 'object') continue;

      const m = raw as Record<string, unknown>;

      if (Array.isArray(m['conditions'])) {
        const conds = m['conditions'] as Record<string, unknown>[];
        const first = conds.find(
          (c) =>
            c &&
            (c['filter'] !== undefined ||
              c['dateFrom'] !== undefined ||
              c['filterTo'] !== undefined)
        );
        if (first) {
          out[colId] = this.flattenSimpleFilter(first);
        }
        continue;
      }

      out[colId] = this.flattenSimpleFilter(m);
    }

    return out;
  }

  private flattenSimpleFilter(m: Record<string, unknown>): Record<string, unknown> {
    const filterType = (m['filterType'] as string) ?? 'text';
    const type = (m['type'] as string) ?? 'contains';
    const filter = m['filter'];
    const filterTo = m['filterTo'];
    const dateFrom = m['dateFrom'];
    const dateTo = m['dateTo'];

    return {
      filterType,
      type,
      filter: filter ?? null,
      filterTo: filterTo ?? null,
      dateFrom: dateFrom ?? null,
      dateTo: dateTo ?? null,
    };
  }

  private setupSearchDebounce(): void {
    this.searchSubject
      .pipe(debounceTime(400), distinctUntilChanged(), takeUntil(this.destroy$))
      .subscribe(() => {
        if (this.gridApi && this.selectedCollection()) {
          this.gridApi.refreshInfiniteCache();
        }
      });
  }

  private pollSyncStatus(): void {
    const interval = setInterval(() => {
      this.dataService.getSyncStatus().subscribe({
        next: (res) => {
          if (!res.data.isRunning) {
            clearInterval(interval);
            this.isSyncing.set(false);
            this.loadCollections();
            this.snackBar.open(
              `Sync complete: ${res.data.lastResult?.tickets ?? res.data.lastResult?.ticketsProcessed ?? 0} tickets, ${res.data.lastResult?.users ?? 0} users`,
              'Dismiss',
              { duration: 5000 }
            );
            this.cdr.markForCheck();
            if (this.gridApi && this.selectedCollection()) {
              this.gridApi.refreshInfiniteCache();
            }
          }
        },
        error: () => {
          clearInterval(interval);
          this.isSyncing.set(false);
          this.cdr.markForCheck();
        },
      });
    }, 3000);
  }

  private pollRevisionSyncStatus(): void {
    const interval = setInterval(() => {
      this.dataService.getRevisionSyncStatus().subscribe({
        next: (res) => {
          if (!res.data.isRunning) {
            clearInterval(interval);
            this.isSyncing.set(false);
            this.loadCollections();
            const upserted = res.data.lastResult?.revisionsUpserted ?? 0;
            this.snackBar.open(
              `Revision sync complete: ${upserted} revisions stored`,
              'Dismiss',
              { duration: 5000 }
            );

            if (upserted > 0) {
              this.onCollectionChange('revision_history');
            } else if (this.gridApi && this.selectedCollection()) {
              this.gridApi.refreshInfiniteCache();
            }

            this.cdr.markForCheck();
          }
        },
        error: () => {
          clearInterval(interval);
          this.isSyncing.set(false);
          this.cdr.markForCheck();
        },
      });
    }, 3000);
  }
}
