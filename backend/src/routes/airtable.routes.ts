import { Router } from 'express';
import { airtableController } from '../controllers/airtable.controller';
import { authenticateJWT } from '../middleware/auth.middleware';

const router = Router();

router.use(authenticateJWT);

router.post('/sync', airtableController.startSync.bind(airtableController));
router.get('/sync/status', airtableController.getSyncStatus.bind(airtableController));
router.get('/bases', airtableController.getBases.bind(airtableController));
router.get('/bases/:baseId/tables', airtableController.getTablesForBase.bind(airtableController));
router.get('/workspace/users', airtableController.getWorkspaceUsers.bind(airtableController));

export default router;
