import mongoose, { Document, Schema } from 'mongoose';

export interface IBase extends Document {
  baseId: string;
  name: string;
  permissionLevel: string;
  syncedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const BaseSchema = new Schema<IBase>(
  {
    baseId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
    },
    permissionLevel: {
      type: String,
      default: 'none',
    },
    syncedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    collection: 'bases',
  }
);

export const BaseModel = mongoose.model<IBase>('Base', BaseSchema);
