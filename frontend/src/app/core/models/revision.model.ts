export interface Revision {
  _id: string;
  uuid: string;
  issueId: string;
  columnType: 'assignee' | 'status';
  oldValue: string | null;
  newValue: string | null;
  createdDate: string;
  authoredBy: string;
}

export interface SyncStatus {
  isRunning: boolean;
  progress?: {
    current: number;
    total: number;
    currentTicketId?: string;
  };
  lastResult?: {
    bases?: number;
    tables?: number;
    tickets?: number;
    ticketsProcessed?: number;
    users?: number;
    revisionsFound?: number;
    revisionsUpserted?: number;
    errors: string[];
  };
  startedAt?: string;
  completedAt?: string;
}
