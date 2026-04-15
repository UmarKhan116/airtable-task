import { Router } from 'express';
import { dataController } from '../controllers/data.controller';
import { authenticateJWT } from '../middleware/auth.middleware';

const router = Router();

router.use(authenticateJWT);

router.get('/collections', dataController.getCollections.bind(dataController));
router.get('/:collection/schema', dataController.getCollectionSchema.bind(dataController));
router.get('/:collection', dataController.getCollectionData.bind(dataController));

export default router;
