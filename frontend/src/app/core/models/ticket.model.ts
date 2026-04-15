export interface Ticket {
  _id: string;
  recordId: string;
  baseId: string;
  tableId: string;
  fields: Record<string, unknown>;
  createdTime?: string;
  syncedAt: string;
  revisionSyncedAt?: string;
}

export interface Base {
  _id: string;
  baseId: string;
  name: string;
  permissionLevel: string;
  syncedAt: string;
}

export interface Table {
  _id: string;
  tableId: string;
  baseId: string;
  name: string;
  fields: TableField[];
}

export interface TableField {
  id: string;
  name: string;
  type: string;
}
