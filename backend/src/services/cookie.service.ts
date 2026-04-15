import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import type { Browser, Page } from 'puppeteer';
import type { CookieData } from 'puppeteer';
import { AirtableSessionModel, ICookie } from '../models/airtable-session.model';
import { AIRTABLE_CONFIG } from '../config/airtable';
import { encrypt, decrypt } from '../utils/encryption';
import { env } from '../config/environment';
import { logger } from '../utils/logger';
import { AppError } from '../middleware/error.middleware';

puppeteer.use(StealthPlugin());

export type MfaType = 'totp' | 'sms' | 'none';

export interface SessionInitResult {
  requiresMfa: boolean;
  mfaType?: MfaType;
  sessionId?: string;
  message?: string;
}

export type ScrapingSessionBannerStatus = 'none' | 'active' | 'expired';

export interface SessionStatus {
  /** Derived state for UI: no document, valid unexpired session, or missing/invalid/expired. */
  status: ScrapingSessionBannerStatus;
  isActive: boolean;
  expiresAt?: Date;
  extractedAt?: Date;
  isValid?: boolean;
}

interface PendingSession {
  browser: Browser;
  page: Page;
  createdAt: number;
}

const pendingSessions = new Map<string, PendingSession>();
const PENDING_SESSION_TTL_MS = 5 * 60 * 1000;

const EMAIL_SELECTORS = [
  'input[name="email"]',
  'input[type="email"]',
  'input[autocomplete="username"]',
  'input[placeholder*="Email" i]',
] as const;

const PASSWORD_SELECTORS = [
  'input[name="password"]',
  'input[type="password"]',
  'input[autocomplete="current-password"]',
] as const;

const CHALLENGE_KEYWORDS = [
  'press and hold',
  'verify you are human',
  'verification challenge',
  'please verify',
  'confirm you are not a robot',
  'security check',
] as const;

const LOGIN_URL_MARKERS = ['/login', '/sign-in', '/signin'];
const LOGGED_IN_MARKERS = ['/workspaces', '/home', 'airtable.com/app', 'airtable.com/shr'];

export class CookieService {
  /**
   * Opens a visible Chrome window, navigates to Airtable login,
   * auto-fills credentials, and extracts cookies on success.
   *
   * If Airtable shows a bot-challenge the user resolves it in the
   * visible window; Puppeteer waits and then continues automatically.
   *
   * @param headless  Force headless mode (true) or visible (false, default).
   *                  Visible is recommended because it bypasses bot detection.
   */
  async initSession(
    email?: string,
    password?: string,
    headless = false
  ): Promise<SessionInitResult> {
    const resolvedEmail = email ?? env.AIRTABLE_EMAIL;
    const resolvedPassword = password ?? env.AIRTABLE_PASSWORD;

    if (!resolvedEmail || !resolvedPassword) {
      throw new AppError('Airtable email/password are required for session init', 400);
    }

    this.cleanExpiredPendingSessions();

    const mode = headless ? 'headless' : 'visible';
    logger.info(`Launching ${mode} Puppeteer for Airtable login`);

    const browser = await puppeteer.launch({
      headless: headless ? ('shell' as never) : false,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-blink-features=AutomationControlled',
        '--window-size=1280,800',
      ],
    });

    const page = await browser.newPage();

    try {
      await page.setViewport({ width: 1280, height: 800 });

      await page.goto(AIRTABLE_CONFIG.SCRAPING.LOGIN_URL, {
        waitUntil: 'domcontentloaded',
        timeout: 45_000,
      });
      await this.sleep(2000);

      // ── Handle bot challenge (visible mode: user clicks; headless: wait + fail gracefully)
      const challengeDetected = await this.hasChallenge(page);
      if (challengeDetected) {
        if (headless) {
          await browser.close();
          throw new AppError(
            'Bot-challenge detected in headless mode. Retry with headless=false (visible browser) so you can complete the challenge.',
            403
          );
        }
        logger.warn('Bot-challenge detected — waiting for user to resolve it in the browser window…');
        await this.waitUntilChallengeGone(page, 120_000);
        await this.sleep(1500);
      }

      // ── Step 1: email → Continue
      const emailSel = await this.waitForVisibleInput(page, EMAIL_SELECTORS, 30_000, 'email field');
      await page.click(emailSel, { clickCount: 3 });
      await page.keyboard.press('Backspace');
      await page.type(emailSel, resolvedEmail, { delay: 40 });
      await this.clickEmailContinue(page);
      await this.sleep(1500);

      // ── Step 2: password → Sign In
      const passSel = await this.waitForVisibleInput(page, PASSWORD_SELECTORS, 20_000, 'password field');
      await page.click(passSel, { clickCount: 3 });
      await page.keyboard.press('Backspace');
      await page.type(passSel, resolvedPassword, { delay: 40 });

      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => {}),
        this.clickPasswordSubmit(page),
      ]);

      await this.sleep(2000);

      // ── Check MFA
      const mfaResult = await this.detectMfa(page);

      if (mfaResult.requiresMfa) {
        const sessionToken = this.generateSessionToken();
        pendingSessions.set(sessionToken, { browser, page, createdAt: Date.now() });

        logger.info('MFA required during Airtable login', { mfaType: mfaResult.mfaType });
        return { requiresMfa: true, mfaType: mfaResult.mfaType, sessionId: sessionToken };
      }

      // ── Wait for redirect to a logged-in page (up to 30 s)
      await this.waitForLoggedIn(page, 30_000);

      // ── Extract cookies
      const rawCookies = await page.cookies();
      await this.persistCookies(rawCookies, resolvedEmail, resolvedPassword);
      await browser.close();

      logger.info('Airtable login successful — cookies extracted');
      return { requiresMfa: false, message: 'Session established. Cookies saved.' };
    } catch (error) {
      await browser.close().catch(() => {});
      logger.error('Puppeteer login failed', { error });

      if (error instanceof AppError) throw error;
      throw new AppError(`Airtable login failed: ${(error as Error).message}`, 500);
    }
  }

  async submitMfa(sessionId: string, code: string): Promise<void> {
    const pending = pendingSessions.get(sessionId);

    if (!pending) {
      throw new AppError('No pending MFA session found or session expired', 400);
    }

    const { browser, page } = pending;

    try {
      const mfaSelector = await this.findMfaInputSelector(page);

      if (!mfaSelector) {
        throw new AppError('MFA input field not found on page', 500);
      }

      await page.waitForSelector(mfaSelector, { timeout: 5_000 });
      await page.focus(mfaSelector);
      await page.keyboard.type(code, { delay: 100 });

      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30_000 }).catch(() => {}),
        page.keyboard.press('Enter'),
      ]);

      const url = page.url();
      if (url.includes('login') || url.includes('mfa') || url.includes('verify')) {
        throw new AppError('MFA code was rejected or login still pending', 401);
      }

      const rawCookies = await page.cookies();
      await this.persistCookies(rawCookies);

      pendingSessions.delete(sessionId);
      await browser.close();

      logger.info('MFA submitted and session established');
    } catch (error) {
      pendingSessions.delete(sessionId);
      await browser.close().catch(() => {});

      if (error instanceof AppError) throw error;
      throw new AppError(`MFA submission failed: ${(error as Error).message}`, 500);
    }
  }

  async getValidCookies(): Promise<ICookie[]> {
    const session = await AirtableSessionModel.findOne({ isValid: true }).sort({
      extractedAt: -1,
    });

    if (!session) {
      throw new AppError(
        'No active Airtable session. Use POST /api/scraping/session/init.',
        401
      );
    }

    if (session.expiresAt < new Date()) {
      logger.info('Airtable session cookies expired');
      await session.updateOne({ isValid: false });
      throw new AppError(
        'Airtable session expired. Run POST /api/scraping/session/init again.',
        401
      );
    }

    return session.cookies;
  }

  /**
   * Validate stored cookies by making a lightweight request to Airtable.
   */
  async validateCookies(): Promise<boolean> {
    try {
      const cookies = await this.getValidCookies();
      const cookieHeader = this.formatCookieHeader(cookies);

      const axios = (await import('axios')).default;
      const response = await axios.get('https://airtable.com/v0.3/user', {
        headers: {
          Cookie: cookieHeader,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        timeout: 10_000,
        validateStatus: () => true,
      });

      const valid = response.status >= 200 && response.status < 400;

      if (!valid) {
        logger.warn('Cookie validation failed', { status: response.status });
        await AirtableSessionModel.updateMany({ isValid: true }, { isValid: false });
      } else {
        await AirtableSessionModel.updateOne(
          { isValid: true },
          { $set: { lastValidatedAt: new Date() } }
        );
      }

      return valid;
    } catch {
      return false;
    }
  }

  formatCookieHeader(cookies: ICookie[]): string {
    return cookies
      .filter((c) => c.name && c.value)
      .map((c) => `${c.name}=${c.value}`)
      .join('; ');
  }

  async getSessionStatus(): Promise<SessionStatus> {
    const latest = await AirtableSessionModel.findOne()
      .sort({ extractedAt: -1 })
      .lean();

    if (!latest) {
      return { status: 'none', isActive: false };
    }

    const now = new Date();
    const expiredByTime = latest.expiresAt < now;
    const inactive = !latest.isValid || expiredByTime;

    if (!inactive) {
      return {
        status: 'active',
        isActive: true,
        expiresAt: latest.expiresAt,
        extractedAt: latest.extractedAt,
        isValid: latest.isValid,
      };
    }

    return {
      status: 'expired',
      isActive: false,
      expiresAt: latest.expiresAt,
      extractedAt: latest.extractedAt,
      isValid: latest.isValid,
    };
  }

  async invalidateSession(): Promise<void> {
    await AirtableSessionModel.updateMany({}, { isValid: false });
    logger.info('All Airtable sessions invalidated');
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async hasChallenge(page: Page): Promise<boolean> {
    try {
      const bodyText = await page.evaluate(() =>
        (document.body?.innerText ?? '').toLowerCase()
      );
      return CHALLENGE_KEYWORDS.some((kw) => bodyText.includes(kw));
    } catch {
      /* Transitional DOM / detached frame — keep waiting, do not treat as challenge cleared. */
      return true;
    }
  }

  /**
   * Poll until the challenge interstitial is gone.
   * In visible mode the user clicks through it; we just watch.
   */
  private async waitUntilChallengeGone(page: Page, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await this.sleep(2000);
      const still = await this.hasChallenge(page);
      if (!still) {
        logger.info('Bot challenge resolved');
        return;
      }
    }
    throw new Error('Bot-challenge was not resolved within the timeout period.');
  }

  /**
   * After submitting credentials, wait for the URL to leave the login page.
   */
  private async waitForLoggedIn(page: Page, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const url = page.url();
      const onLogin = LOGIN_URL_MARKERS.some((m) => url.includes(m));
      const onDashboard = LOGGED_IN_MARKERS.some((m) => url.includes(m));

      if (!onLogin || onDashboard) return;
      await this.sleep(1000);
    }
    // Not a hard failure — cookies may still be valid even on a redirect
    logger.warn('Timed out waiting for post-login redirect, extracting cookies anyway');
  }

  private async waitForVisibleInput(
    page: Page,
    selectors: readonly string[],
    timeoutMs: number,
    description: string
  ): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      for (const sel of selectors) {
        try {
          const handle = await page.$(sel);
          if (!handle) continue;
          const visible = await handle.evaluate((el) => {
            if (!(el instanceof HTMLElement)) return false;
            const style = window.getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            return (
              style.visibility !== 'hidden' &&
              style.display !== 'none' &&
              rect.width > 0 &&
              rect.height > 0
            );
          });
          await handle.dispose();
          if (visible) return sel;
        } catch {
          /* try next */
        }
      }
      await this.sleep(300);
    }
    throw new Error(`Timeout waiting for visible ${description}.`);
  }

  private async clickEmailContinue(page: Page): Promise<void> {
    const testId = await page.$('button[data-testid="continue-button"]');
    if (testId) { await testId.click(); await testId.dispose(); return; }

    const clicked = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const found = buttons.find((b) => /^\s*continue\s*$/i.test((b.textContent ?? '').trim()));
      if (found) { found.click(); return true; }
      return false;
    });
    if (clicked) return;

    const submits = await page.$$('button[type="submit"]');
    try {
      for (const btn of submits) {
        const label = await btn.evaluate((el) => (el.textContent ?? '').trim());
        if (/continue/i.test(label)) { await btn.click(); return; }
      }
    } finally {
      await Promise.all(submits.map((b) => b.dispose().catch(() => {})));
    }

    throw new Error('Could not find Continue button after entering email');
  }

  private async clickPasswordSubmit(page: Page): Promise<void> {
    const signInBtn = await page.$('button[data-testid="sign-in-button"]');
    if (signInBtn) { await signInBtn.click(); await signInBtn.dispose(); return; }

    const clicked = await page.evaluate(() => {
      const buttons = Array.from(
        document.querySelectorAll('button[type="submit"], button')
      ) as HTMLButtonElement[];
      const match = buttons.find((b) => {
        const t = (b.textContent ?? '').trim();
        return /^(sign in|log in)\s*$/i.test(t);
      });
      if (match) { match.click(); return true; }
      return false;
    });
    if (clicked) return;

    const submit = await page.$('button[type="submit"]');
    if (submit) { await submit.click(); await submit.dispose(); return; }

    await page.keyboard.press('Enter');
  }

  private async detectMfa(page: Page): Promise<{ requiresMfa: boolean; mfaType?: MfaType }> {
    const url = page.url();
    if (url.includes('/mfa') || url.includes('/verify') || url.includes('/two-factor')) {
      return { requiresMfa: true, mfaType: 'totp' };
    }

    const mfaSelectors = [
      'input[name="mfaCode"]',
      'input[name="totpToken"]',
      'input[placeholder*="code" i]',
      'input[aria-label*="code" i]',
      'input[data-testid*="mfa"]',
    ];

    for (const selector of mfaSelectors) {
      const el = await page.$(selector);
      if (el) return { requiresMfa: true, mfaType: 'totp' };
    }

    try {
      const bodyText = await page.evaluate(() =>
        (document.body?.innerText ?? '').toLowerCase()
      );
      if (
        bodyText.includes('verification code') ||
        bodyText.includes('authenticator') ||
        bodyText.includes('two-factor')
      ) {
        return { requiresMfa: true, mfaType: 'totp' };
      }
      if (bodyText.includes('sent a code') || bodyText.includes('text message')) {
        return { requiresMfa: true, mfaType: 'sms' };
      }
    } catch {
      /* navigation / transitional document */
    }

    return { requiresMfa: false };
  }

  private async findMfaInputSelector(page: Page): Promise<string | null> {
    const selectors = [
      'input[name="mfaCode"]',
      'input[name="totpToken"]',
      'input[name="code"]',
      'input[type="number"]',
      'input[placeholder*="code" i]',
      'input[aria-label*="code" i]',
    ];

    for (const sel of selectors) {
      const el = await page.$(sel);
      if (el) return sel;
    }
    return null;
  }

  private async persistCookies(
    rawCookies: CookieData[],
    email?: string,
    password?: string
  ): Promise<void> {
    const cookies: ICookie[] = rawCookies
      .filter((c) => c.name && c.value)
      .map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
        expires: c.expires,
        httpOnly: c.httpOnly,
        secure: c.secure,
        sameSite: c.sameSite as string | undefined,
      }));

    if (cookies.length < 5) {
      logger.warn('Too few cookies extracted — skipping persist to avoid partial sessions', {
        count: cookies.length,
      });
      return;
    }

    const sessionCookie = rawCookies.find(
      (c) => c.name.toLowerCase().includes('session') || c.name.toLowerCase().includes('auth')
    );
    const expiresAt = sessionCookie?.expires
      ? new Date(sessionCookie.expires * 1000)
      : new Date(Date.now() + 24 * 60 * 60 * 1000);

    let encryptedCredentials: string | undefined;
    if (email && password) {
      encryptedCredentials = encrypt(JSON.stringify({ email, password }));
    }

    await AirtableSessionModel.updateMany({}, { isValid: false });

    await AirtableSessionModel.create({
      cookies,
      encryptedCredentials,
      extractedAt: new Date(),
      expiresAt,
      isValid: true,
    });

    logger.info('Airtable session cookies persisted', { count: cookies.length });
  }

  private cleanExpiredPendingSessions(): void {
    const now = Date.now();
    for (const [key, session] of pendingSessions.entries()) {
      if (now - session.createdAt > PENDING_SESSION_TTL_MS) {
        session.browser.close().catch(() => {});
        pendingSessions.delete(key);
      }
    }
  }

  private generateSessionToken(): string {
    return require('crypto').randomBytes(32).toString('hex') as string;
  }
}

export const cookieService = new CookieService();
