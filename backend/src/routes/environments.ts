import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { requireUser, requireUserId } from '../lib/auth';
import { Environment } from '../types';
import {
  deleteEnvironment as deleteStoredEnvironment,
  getEnvironment,
  listEnvironments,
  upsertEnvironment,
} from '../storage/supabaseStore';

const router = Router();
router.use(requireUser);

// GET all environments
router.get('/', async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  const envs = await listEnvironments(userId);
  res.json(envs);
});

// POST create environment
router.post('/', async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  const now = new Date().toISOString();

  const newEnv: Environment = {
    id: uuidv4(),
    name: req.body.name || 'New Environment',
    variables: req.body.variables || [],
    isActive: req.body.isActive || false,
    ownerUserId: userId,
    storageScope: 'remote',
    createdAt: now,
    updatedAt: now,
  };
  const saved = await upsertEnvironment(userId, newEnv);
  res.status(201).json(saved);
});

// PUT update environment
router.put('/:id', async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  const existing = await getEnvironment(userId, req.params.id);
  if (!existing) return res.status(404).json({ error: 'Environment not found' });

  const saved = await upsertEnvironment(userId, {
    ...existing,
    ...req.body,
    id: req.params.id,
    ownerUserId: userId,
    storageScope: 'remote',
    updatedAt: new Date().toISOString(),
  });
  return res.json(saved);
});

// DELETE environment
router.delete('/:id', async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  const deleted = await deleteStoredEnvironment(userId, req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: 'Environment not found' });
  }
  return res.json({ success: true });
});

// POST activate environment
router.post('/:id/activate', async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  const env = await getEnvironment(userId, req.params.id);
  if (!env) return res.status(404).json({ error: 'Environment not found' });

  env.isActive = true;
  env.updatedAt = new Date().toISOString();
  const saved = await upsertEnvironment(userId, env);
  return res.json(saved);
});

export default router;
