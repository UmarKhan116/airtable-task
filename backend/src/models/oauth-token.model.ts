import mongoose, { Document, Schema } from 'mongoose';

export interface IOAuthToken extends Document {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  scope: string[];
  expiresAt: Date;
  userId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const OAuthTokenSchema = new Schema<IOAuthToken>(
  {
    accessToken: {
      type: String,
      required: true,
    },
    refreshToken: {
      type: String,
      required: true,
    },
    tokenType: {
      type: String,
      default: 'Bearer',
    },
    scope: {
      type: [String],
      default: [],
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    userId: {
      type: String,
    },
  },
  {
    timestamps: true,
    collection: 'oauth_tokens',
  }
);

OAuthTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const OAuthTokenModel = mongoose.model<IOAuthToken>('OAuthToken', OAuthTokenSchema);
