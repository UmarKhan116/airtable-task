import mongoose, { Document, Schema } from 'mongoose';

export interface ITicket extends Document {
  recordId: string;
  baseId: string;
  tableId: string;
  fields: Record<string, unknown>;
  createdTime: Date;
  syncedAt: Date;
  revisionSyncedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const TicketSchema = new Schema<ITicket>(
  {
    recordId: {
      type: String,
      required: true,
      index: true,
    },
    baseId: {
      type: String,
      required: true,
      index: true,
    },
    tableId: {
      type: String,
      required: true,
      index: true,
    },
    fields: {
      type: Schema.Types.Mixed,
      default: {},
    },
    createdTime: {
      type: Date,
    },
    syncedAt: {
      type: Date,
      default: Date.now,
    },
    revisionSyncedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
    collection: 'tickets',
  }
);

TicketSchema.index({ baseId: 1, tableId: 1, recordId: 1 }, { unique: true });
TicketSchema.index({ revisionSyncedAt: 1 });

export const TicketModel = mongoose.model<ITicket>('Ticket', TicketSchema);
