import { Request, Response, NextFunction } from 'express';
import { cookieService } from '../services/cookie.service';
import { scrapingService } from '../services/scraping.service';
import { AppError } from '../middleware/error.middleware';

export class ScrapingController {
  /**
   * POST /api/scraping/session/init
   * Opens a browser (visible by default), navigates to Airtable login,
   * auto-fills credentials, and extracts cookies on success.
   *
   * Body: { email?: string, password?: string, headless?: boolean }
   *
   * When headless is false (default) a Chrome window opens so the user
   * can resolve any bot-challenge. Credentials are filled automatically.
   */
  async initSession(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email, password, headless } = req.body as {
        email?: string;
        password?: string;
        headless?: boolean;
      };
      const result = await cookieService.initSession(email, password, headless ?? false);

      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/scraping/session/mfa
   * Submit MFA code for a pending Puppeteer session.
   * Body: { sessionId: string, code: string }
   */
  async submitMfa(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { sessionId, code } = req.body as { sessionId?: string; code?: string };

      if (!sessionId || !code) {
        throw new AppError('sessionId and code are required', 400);
      }

      await cookieService.submitMfa(sessionId, code);

      res.json({ success: true, message: 'MFA accepted, session established' });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/scraping/session/validate
   * Check if the stored cookies are still accepted by Airtable.
   */
  async validateSession(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const valid = await cookieService.validateCookies();
      res.json({
        success: true,
        data: { valid },
        message: valid
          ? 'Cookies are valid.'
          : 'Cookies are invalid or expired. Please re-authenticate.',
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/scraping/session/status
   * Returns current Airtable session cookie validity.
   */
  async getSessionStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const status = await cookieService.getSessionStatus();
      res.json({ success: true, data: status });
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /api/scraping/session
   * Invalidates the current Airtable session.
   */
  async invalidateSession(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      await cookieService.invalidateSession();
      res.json({ success: true, message: 'Session invalidated' });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/scraping/revisions/sync
   * Starts background revision history sync for all tickets.
   */
  async startRevisionSync(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const status = scrapingService.getStatus();

      if (status.isRunning) {
        res.status(202).json({
          success: true,
          message: 'Revision sync already in progress',
          data: status,
        });
        return;
      }

      scrapingService.syncAllRevisions().catch((err) => {
        console.error('Background revision sync error:', err);
      });

      res.status(202).json({
        success: true,
        message: 'Revision sync started',
        data: { startedAt: new Date() },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/scraping/revisions/status
   * Returns the current revision sync status.
   */
  getRevisionSyncStatus(req: Request, res: Response, next: NextFunction): void {
    try {
      const status = scrapingService.getStatus();
      res.json({ success: true, data: status });
    } catch (error) {
      next(error);
    }
  }
}

export const scrapingController = new ScrapingController();
