import { Router } from 'express';
import { scrapingController } from '../controllers/scraping.controller';
import { authenticateJWT } from '../middleware/auth.middleware';
import { scrapingLimiter } from '../middleware/rate-limit.middleware';

const router = Router();

router.use(authenticateJWT);

// Session management
router.post('/session/init', scrapingLimiter, scrapingController.initSession.bind(scrapingController));
router.post('/session/mfa', scrapingLimiter, scrapingController.submitMfa.bind(scrapingController));
router.get('/session/status', scrapingController.getSessionStatus.bind(scrapingController));
router.get('/session/validate', scrapingController.validateSession.bind(scrapingController));
router.delete('/session', scrapingController.invalidateSession.bind(scrapingController));

// Revision sync
router.post('/revisions/sync', scrapingLimiter, scrapingController.startRevisionSync.bind(scrapingController));
router.get('/revisions/status', scrapingController.getRevisionSyncStatus.bind(scrapingController));

export default router;
