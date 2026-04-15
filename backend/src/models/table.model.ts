import mongoose, { Document, Schema } from 'mongoose';

export interface IField {
  id: string;
  name: string;
  type: string;
  description?: string;
  options?: Record<string, unknown>;
}

export interface IView {
  id: string;
  name: string;
  type: string;
}

export interface ITable extends Document {
  tableId: string;
  baseId: string;
  name: string;
  description?: string;
  primaryFieldId: string;
  fields: IField[];
  views: IView[];
  syncedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const FieldSchema = new Schema<IField>(
  {
    id: { type: String, required: true },
    name: { type: String, required: true },
    type: { type: String, required: true },
    description: String,
    options: { type: Schema.Types.Mixed },
  },
  { _id: false }
);

const ViewSchema = new Schema<IView>(
  {
    id: { type: String, required: true },
    name: { type: String, required: true },
    type: { type: String, required: true },
  },
  { _id: false }
);

const TableSchema = new Schema<ITable>(
  {
    tableId: {
      type: String,
      required: true,
      index: true,
    },
    baseId: {
      type: String,
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
    },
    description: String,
    primaryFieldId: {
      type: String,
      required: true,
    },
    fields: {
      type: [FieldSchema],
      default: [],
    },
    views: {
      type: [ViewSchema],
      default: [],
    },
    syncedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    collection: 'tables',
  }
);

TableSchema.index({ baseId: 1, tableId: 1 }, { unique: true });

export const TableModel = mongoose.model<ITable>('Table', TableSchema);
