import { Router, Request, Response } from 'express';
import { requireUser, requireUserId } from '../lib/auth';
import {
  normalizeCollection,
  normalizeEnvironment,
  syncCollections,
  syncEnvironments,
} from '../storage/supabaseStore';
import { Collection, Environment } from '../types';

const router = Router();
router.use(requireUser);

router.post('/local', async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  const collections = Array.isArray(req.body.collections)
    ? (req.body.collections as Partial<Collection>[]).map(normalizeCollection)
    : [];
  const environments = Array.isArray(req.body.environments)
    ? (req.body.environments as Partial<Environment>[]).map(normalizeEnvironment)
    : [];

  await syncCollections(userId, collections);
  await syncEnvironments(userId, environments);

  res.json({ success: true, syncedCollections: collections.length, syncedEnvironments: environments.length });
});

export default router;