import { Router, Request, Response } from 'express';
import { getPublicCollectionByToken, getPublicDocsByToken, getPublicFormByToken } from '../storage/supabaseStore';

const router = Router();

router.get('/runtime-config', (_req: Request, res: Response) => {
  const clerkPublishableKey = String(process.env.CLERK_PUBLISHABLE_KEY || '').trim();
  res.json({
    clerkPublishableKey,
  });
});

router.get('/collections/:token', async (req: Request, res: Response) => {
  const collection = await getPublicCollectionByToken(req.params.token);
  if (!collection) {
    res.status(404).json({ error: 'Shared collection not found' });
    return;
  }

  res.json(collection);
});

router.get('/docs/:token', async (req: Request, res: Response) => {
  const collection = await getPublicDocsByToken(req.params.token);
  if (!collection) {
    res.status(404).json({ error: 'Shared documentation not found' });
    return;
  }

  res.json(collection);
});

router.get('/forms/:token', async (req: Request, res: Response) => {
  const collection = await getPublicFormByToken(req.params.token);
  if (!collection) {
    res.status(404).json({ error: 'Shared form not found' });
    return;
  }

  res.json(collection);
});

export default router;