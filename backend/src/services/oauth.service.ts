import axios from 'axios';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { OAuthTokenModel, IOAuthToken } from '../models/oauth-token.model';
import { AIRTABLE_CONFIG } from '../config/airtable';
import { env } from '../config/environment';
import { logger } from '../utils/logger';
import { AppError } from '../middleware/error.middleware';

interface AirtableTokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
}

interface AirtableUserInfo {
  id: string;
  email: string;
  name: string;
}

// In-memory state store (use Redis in production for multi-instance)
const stateStore = new Map<string, { createdAt: number; codeVerifier: string }>();

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export class OAuthService {
  generateAuthorizationUrl(): { url: string; state: string } {
    const state = crypto.randomBytes(32).toString('hex');

    // PKCE: generate a high-entropy verifier (43–128 chars, base64url)
    const codeVerifier = crypto.randomBytes(32).toString('base64url');

    // PKCE: challenge = BASE64URL(SHA256(verifier))
    const codeChallenge = crypto
      .createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');

    stateStore.set(state, { createdAt: Date.now(), codeVerifier });

    // Clean expired states
    for (const [key, val] of stateStore.entries()) {
      if (Date.now() - val.createdAt > STATE_TTL_MS) {
        stateStore.delete(key);
      }
    }

    const params = new URLSearchParams({
      client_id: AIRTABLE_CONFIG.CLIENT_ID,
      redirect_uri: AIRTABLE_CONFIG.REDIRECT_URI,
      response_type: 'code',
      scope: AIRTABLE_CONFIG.SCOPES.join(' '),
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    const url = `${AIRTABLE_CONFIG.AUTH_URL}/authorize?${params.toString()}`;
    return { url, state };
  }

  validateState(state: string): { isValid: boolean; codeVerifier?: string } {
    const entry = stateStore.get(state);
    if (!entry) return { isValid: false };

    const isValid = Date.now() - entry.createdAt < STATE_TTL_MS;
    const codeVerifier = entry.codeVerifier;
    stateStore.delete(state);
    return { isValid, codeVerifier };
  }

  async exchangeCodeForTokens(code: string, codeVerifier: string): Promise<IOAuthToken> {
    try {
      const credentials = Buffer.from(
        `${AIRTABLE_CONFIG.CLIENT_ID}:${AIRTABLE_CONFIG.CLIENT_SECRET}`
      ).toString('base64');

      const response = await axios.post<AirtableTokenResponse>(
        `${AIRTABLE_CONFIG.AUTH_URL}/token`,
        new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: AIRTABLE_CONFIG.REDIRECT_URI,
          code_verifier: codeVerifier,
        }).toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: `Basic ${credentials}`,
          },
        }
      );

      const { access_token, refresh_token, token_type, expires_in, scope } = response.data;

      const expiresAt = new Date(Date.now() + expires_in * 1000);

      // Upsert — keep only one token record (single-user for now)
      const token = await OAuthTokenModel.findOneAndUpdate(
        {},
        {
          accessToken: access_token,
          refreshToken: refresh_token,
          tokenType: token_type,
          scope: scope.split(' '),
          expiresAt,
        },
        { upsert: true, new: true }
      );

      if (!token) throw new AppError('Failed to store token', 500);

      logger.info('OAuth tokens stored successfully');
      return token;
    } catch (error) {
      logger.error('Failed to exchange code for tokens', { error });
      throw new AppError('Failed to exchange authorization code', 500);
    }
  }

  async refreshAccessToken(): Promise<IOAuthToken> {
    const existingToken = await OAuthTokenModel.findOne().sort({ updatedAt: -1 });

    if (!existingToken) {
      throw new AppError('No tokens found, please authenticate first', 401);
    }

    try {
      const credentials = Buffer.from(
        `${AIRTABLE_CONFIG.CLIENT_ID}:${AIRTABLE_CONFIG.CLIENT_SECRET}`
      ).toString('base64');

      const response = await axios.post<AirtableTokenResponse>(
        `${AIRTABLE_CONFIG.AUTH_URL}/token`,
        new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: existingToken.refreshToken,
        }).toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: `Basic ${credentials}`,
          },
        }
      );

      const { access_token, refresh_token, token_type, expires_in, scope } = response.data;
      const expiresAt = new Date(Date.now() + expires_in * 1000);

      const updated = await OAuthTokenModel.findByIdAndUpdate(
        existingToken._id,
        {
          accessToken: access_token,
          refreshToken: refresh_token,
          tokenType: token_type,
          scope: scope.split(' '),
          expiresAt,
        },
        { new: true }
      );

      if (!updated) throw new AppError('Failed to update token record', 500);

      logger.info('OAuth access token refreshed');
      return updated;
    } catch (error) {
      if (error instanceof AppError) throw error;
      logger.error('Failed to refresh access token', { error });
      throw new AppError('Failed to refresh access token', 500);
    }
  }

  async getValidAccessToken(): Promise<string> {
    const tokenDoc = await OAuthTokenModel.findOne().sort({ updatedAt: -1 });

    if (!tokenDoc) {
      throw new AppError('Not authenticated with Airtable', 401);
    }

    // Refresh if expired or expiring within 5 minutes
    const fiveMinutes = 5 * 60 * 1000;
    if (tokenDoc.expiresAt.getTime() - Date.now() < fiveMinutes) {
      const refreshed = await this.refreshAccessToken();
      return refreshed.accessToken;
    }

    return tokenDoc.accessToken;
  }

  async getUserInfo(): Promise<AirtableUserInfo> {
    const accessToken = await this.getValidAccessToken();

    const response = await axios.get<AirtableUserInfo>(
      `${AIRTABLE_CONFIG.META_URL}/whoami`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    return response.data;
  }

  generateAppJwt(userId: string): string {
    return jwt.sign({ userId }, env.JWT_SECRET, {
      expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
    });
  }

  async getTokenStatus(): Promise<{
    isAuthenticated: boolean;
    expiresAt?: Date;
    scopes?: string[];
  }> {
    const token = await OAuthTokenModel.findOne().sort({ updatedAt: -1 });
    if (!token) return { isAuthenticated: false };

    return {
      isAuthenticated: token.expiresAt > new Date(),
      expiresAt: token.expiresAt,
      scopes: token.scope,
    };
  }
}

export const oauthService = new OAuthService();
