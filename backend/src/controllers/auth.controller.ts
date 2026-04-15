import { Request, Response, NextFunction } from 'express';
import { oauthService } from '../services/oauth.service';
import { env } from '../config/environment';
import { logger } from '../utils/logger';

export class AuthController {
  /**
   * GET /api/auth/airtable
   * Redirects the user to Airtable's OAuth consent screen.
   */
  initiateOAuth(req: Request, res: Response, next: NextFunction): void {
    try {
      const { url, state } = oauthService.generateAuthorizationUrl();
      logger.info('Initiating Airtable OAuth', { state });

      // For API clients that prefer a JSON response with the URL
      if (req.headers.accept?.includes('application/json')) {
        res.json({ success: true, data: { authorizationUrl: url } });
        return;
      }

      res.redirect(url);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/auth/callback
   * Handles Airtable's OAuth callback, exchanges code for tokens.
   */
  async handleCallback(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { code, state, error, error_description } = req.query as Record<string, string>;

      if (error) {
        logger.warn('OAuth callback error', { error, error_description });
        res.redirect(
          `${env.FRONTEND_URL}/auth/callback?error=${encodeURIComponent(error_description ?? error)}`
        );
        return;
      }

      if (!code || !state) {
        res.redirect(`${env.FRONTEND_URL}/auth/callback?error=missing_parameters`);
        return;
      }

      const { isValid, codeVerifier } = oauthService.validateState(state);
      if (!isValid || !codeVerifier) {
        logger.warn('Invalid OAuth state parameter', { state });
        res.redirect(`${env.FRONTEND_URL}/auth/callback?error=invalid_state`);
        return;
      }

      await oauthService.exchangeCodeForTokens(code, codeVerifier);
      const userInfo = await oauthService.getUserInfo();
      const appToken = oauthService.generateAppJwt(userInfo.id);

      logger.info('OAuth authentication successful', { userId: userInfo.id });
      res.redirect(
        `${env.FRONTEND_URL}/auth/callback?token=${encodeURIComponent(appToken)}`
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/auth/refresh
   * Refreshes the Airtable access token.
   */
  async refreshToken(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const token = await oauthService.refreshAccessToken();
      res.json({
        success: true,
        data: {
          expiresAt: token.expiresAt,
          scope: token.scope,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/auth/status
   * Returns current OAuth authentication status.
   */
  async getStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const status = await oauthService.getTokenStatus();
      res.json({ success: true, data: status });
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /api/auth/logout
   * Clears stored tokens.
   */
  async logout(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { OAuthTokenModel } = await import('../models/oauth-token.model');
      await OAuthTokenModel.deleteMany({});
      logger.info('OAuth tokens cleared');
      res.json({ success: true, message: 'Logged out successfully' });
    } catch (error) {
      next(error);
    }
  }
}

export const authController = new AuthController();
