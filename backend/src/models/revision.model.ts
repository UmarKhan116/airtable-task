import mongoose, { Document, Schema } from 'mongoose';

export interface IRevision extends Document {
  uuid: string;
  issueId: string;
  columnType: 'assignee' | 'status';
  oldValue: string | null;
  newValue: string | null;
  createdDate: Date;
  authoredBy: string;
  createdAt: Date;
  updatedAt: Date;
}

const RevisionSchema = new Schema<IRevision>(
  {
    uuid: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    issueId: {
      type: String,
      required: true,
      index: true,
    },
    columnType: {
      type: String,
      enum: ['assignee', 'status'],
      required: true,
      index: true,
    },
    oldValue: {
      type: String,
      default: null,
    },
    newValue: {
      type: String,
      default: null,
    },
    createdDate: {
      type: Date,
      required: true,
      index: true,
    },
    authoredBy: {
      type: String,
      required: true,
      index: true,
    },
  },
  {
    timestamps: true,
    collection: 'revision_history',
  }
);

RevisionSchema.index({ issueId: 1, createdDate: -1 });
RevisionSchema.index({ authoredBy: 1, createdDate: -1 });

export const RevisionModel = mongoose.model<IRevision>('Revision', RevisionSchema);
