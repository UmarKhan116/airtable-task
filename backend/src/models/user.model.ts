import mongoose, { Document, Schema } from 'mongoose';

export interface IUserBaseAccess {
  baseId: string;
  permissionLevel?: string;
}

export interface IUser extends Document {
  userId: string;
  email?: string;
  name?: string;
  bases: IUserBaseAccess[];
  syncedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const BaseAccessSchema = new Schema<IUserBaseAccess>(
  {
    baseId: { type: String, required: true },
    permissionLevel: { type: String },
  },
  { _id: false }
);

const UserSchema = new Schema<IUser>(
  {
    userId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    email: { type: String },
    name: { type: String },
    bases: { type: [BaseAccessSchema], default: [] },
    syncedAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
    collection: 'users',
  }
);

UserSchema.index({ email: 1 });

export const UserModel = mongoose.model<IUser>('User', UserSchema);
