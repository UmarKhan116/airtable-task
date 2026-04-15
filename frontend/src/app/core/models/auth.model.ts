export interface AuthStatus {
  isAuthenticated: boolean;
  expiresAt?: string;
  scopes?: string[];
}

export type ScrapingSessionBannerStatus = 'none' | 'active' | 'expired';

export interface SessionStatus {
  status: ScrapingSessionBannerStatus;
  isActive: boolean;
  expiresAt?: string;
  extractedAt?: string;
  isValid?: boolean;
}

export interface SessionInitResult {
  requiresMfa: boolean;
  mfaType?: 'totp' | 'sms' | 'none';
  sessionId?: string;
}
