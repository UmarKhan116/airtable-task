import mongoose, { Document, Schema } from 'mongoose';

export interface ICookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: string;
}

export interface IAirtableSession extends Document {
  cookies: ICookie[];
  encryptedCredentials?: string;
  extractedAt: Date;
  expiresAt: Date;
  isValid: boolean;
  lastValidatedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const CookieSchema = new Schema<ICookie>(
  {
    name: { type: String, required: true },
    value: { type: String, required: true },
    domain: String,
    path: String,
    expires: Number,
    httpOnly: Boolean,
    secure: Boolean,
    sameSite: String,
  },
  { _id: false }
);

const AirtableSessionSchema = new Schema<IAirtableSession>(
  {
    cookies: {
      type: [CookieSchema],
      required: true,
    },
    encryptedCredentials: {
      type: String,
    },
    extractedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    isValid: {
      type: Boolean,
      default: true,
    },
    lastValidatedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
    collection: 'airtable_sessions',
  }
);

AirtableSessionSchema.index({ expiresAt: 1 });
AirtableSessionSchema.index({ isValid: 1 });

export const AirtableSessionModel = mongoose.model<IAirtableSession>(
  'AirtableSession',
  AirtableSessionSchema
);
