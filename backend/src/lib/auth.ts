import type { NextFunction, Request, Response } from 'express';
import { getAuth } from '@clerk/express';

export function getUserId(req: Request): string | null {
  try {
    return getAuth(req).userId ?? null;
  } catch {
    return null;
  }
}

export function requireUser(req: Request, res: Response, next: NextFunction): void {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  next();
}

export function requireUserId(req: Request): string {
  const userId = getUserId(req);
  if (!userId) {
    throw new Error('AUTH_REQUIRED');
  }
  return userId;
}