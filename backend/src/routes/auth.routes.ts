import { Router } from 'express';
import { authController } from '../controllers/auth.controller';
import { authLimiter } from '../middleware/rate-limit.middleware';
import { authenticateJWT } from '../middleware/auth.middleware';

const router = Router();

// Apply auth-specific rate limiting
router.use(authLimiter);

// Public routes (no JWT required)
router.get('/airtable', authController.initiateOAuth.bind(authController));
router.get('/callback', authController.handleCallback.bind(authController));
router.get('/status', authController.getStatus.bind(authController));

// Protected routes
router.post('/refresh', authenticateJWT, authController.refreshToken.bind(authController));
router.delete('/logout', authenticateJWT, authController.logout.bind(authController));

export default router;
