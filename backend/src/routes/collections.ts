import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { requireUser, requireUserId } from '../lib/auth';
import { resolveClerkUserId } from '../lib/clerkUsers';
import { Collection, ApiRequest, CollectionMemberRole, VisibilityMode } from '../types';
import {
  getCollection,
  getCollectionAccess,
  listCollectionMembers,
  listCollections,
  normalizeCollection,
  removeCollectionMember,
  setCollectionShareAccess,
  upsertCollectionMember,
  upsertCollection,
  deleteCollection as deleteStoredCollection,
} from '../storage/supabaseStore';

const router = Router();
router.use(requireUser);

function canEditCollection(role: 'owner' | 'editor' | 'viewer'): boolean {
  return role === 'owner' || role === 'editor';
}

// GET all collections
router.get('/', async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  const collections = await listCollections(userId);
  res.json(collections);
});

// POST create collection
router.post('/', async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  const now = new Date().toISOString();
  const newCollection: Collection = {
    id: uuidv4(),
    name: req.body.name || 'New Collection',
    description: req.body.description || '',
    requests: [],
    folders: [],
    variables: [],
    sharing: {
      collection: { access: 'private', token: null },
      docs: { access: 'private', token: null },
    },
    ownerUserId: userId,
    storageScope: 'remote',
    createdAt: now,
    updatedAt: now,
  };
  const saved = await upsertCollection(userId, newCollection);
  res.status(201).json(saved);
});

// PUT update collection
router.put('/:id', async (req: Request, res: Response) => {
  const actorUserId = requireUserId(req);
  const access = await getCollectionAccess(actorUserId, req.params.id);
  if (!access) return res.status(404).json({ error: 'Collection not found' });
  if (!canEditCollection(access.role)) return res.status(403).json({ error: 'Insufficient permissions' });

  const existing = access.collection;
  const ownerUserId = existing.ownerUserId || actorUserId;
  const updated = await upsertCollection(ownerUserId, normalizeCollection({
    ...existing,
    ...req.body,
    id: req.params.id,
    sharing: existing.sharing,
    collaborators: existing.collaborators,
    ownerUserId,
    storageScope: 'remote',
    updatedAt: new Date().toISOString(),
  }));
  return res.json(updated);
});

// DELETE collection
router.delete('/:id', async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  const deleted = await deleteStoredCollection(userId, req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: 'Collection not found' });
  }
  return res.json({ success: true });
});

// POST add request to collection
router.post('/:collectionId/requests', async (req: Request, res: Response) => {
  const actorUserId = requireUserId(req);
  const access = await getCollectionAccess(actorUserId, req.params.collectionId);
  if (!access) return res.status(404).json({ error: 'Collection not found' });
  if (!canEditCollection(access.role)) return res.status(403).json({ error: 'Insufficient permissions' });

  const collection = access.collection;
  const ownerUserId = collection.ownerUserId || actorUserId;

  const now = new Date().toISOString();
  const newRequest: ApiRequest = {
    id: uuidv4(),
    name: req.body.name || 'New Request',
    method: req.body.method || 'GET',
    url: req.body.url || '',
    params: req.body.params || [],
    headers: req.body.headers || [],
    body: req.body.body || { type: 'none', content: '' },
    auth: req.body.auth || { type: 'none' },
    preRequestScript: req.body.preRequestScript || '',
    testScript: req.body.testScript || '',
    retryPolicy: req.body.retryPolicy,
    mockExamples: Array.isArray(req.body.mockExamples) ? req.body.mockExamples : [],
    description: req.body.description || '',
    createdAt: now,
    updatedAt: now,
  };

  collection.requests.push(newRequest);
  collection.updatedAt = now;
  await upsertCollection(ownerUserId, collection);
  return res.status(201).json(newRequest);
});

// PUT update request in collection
router.put('/:collectionId/requests/:requestId', async (req: Request, res: Response) => {
  const actorUserId = requireUserId(req);
  const access = await getCollectionAccess(actorUserId, req.params.collectionId);
  if (!access) return res.status(404).json({ error: 'Collection not found' });
  if (!canEditCollection(access.role)) return res.status(403).json({ error: 'Insufficient permissions' });

  const collection = access.collection;
  const ownerUserId = collection.ownerUserId || actorUserId;

  const reqIdx = collection.requests.findIndex((r) => r.id === req.params.requestId);
  if (reqIdx === -1) return res.status(404).json({ error: 'Request not found' });

  const expectedUpdatedAt = typeof req.body.expectedUpdatedAt === 'string' ? req.body.expectedUpdatedAt : null;
  if (expectedUpdatedAt && collection.requests[reqIdx].updatedAt !== expectedUpdatedAt) {
    return res.status(409).json({ error: 'Request has been updated by another collaborator. Refresh before saving.' });
  }

  const now = new Date().toISOString();
  collection.requests[reqIdx] = {
    ...collection.requests[reqIdx],
    ...req.body,
    id: req.params.requestId,
    updatedAt: now,
  };
  collection.updatedAt = now;
  await upsertCollection(ownerUserId, collection);
  return res.json(collection.requests[reqIdx]);
});

// DELETE request from collection
router.delete('/:collectionId/requests/:requestId', async (req: Request, res: Response) => {
  const actorUserId = requireUserId(req);
  const access = await getCollectionAccess(actorUserId, req.params.collectionId);
  if (!access) return res.status(404).json({ error: 'Collection not found' });
  if (!canEditCollection(access.role)) return res.status(403).json({ error: 'Insufficient permissions' });

  const collection = access.collection;
  const ownerUserId = collection.ownerUserId || actorUserId;

  const before = collection.requests.length;
  collection.requests = collection.requests.filter((r) => r.id !== req.params.requestId);
  if (collection.requests.length === before) {
    return res.status(404).json({ error: 'Request not found' });
  }
  collection.updatedAt = new Date().toISOString();
  await upsertCollection(ownerUserId, collection);
  return res.json({ success: true });
});

// POST share collection or docs
router.post('/:id/share', async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  const target = req.body.target as 'collection' | 'docs';
  const access = req.body.access as VisibilityMode;

  if (!['collection', 'docs'].includes(target)) {
    return res.status(400).json({ error: 'Invalid share target' });
  }

  if (!['private', 'public'].includes(access)) {
    return res.status(400).json({ error: 'Invalid visibility mode' });
  }

  const updated = await setCollectionShareAccess(userId, req.params.id, target, access);
  if (!updated) {
    return res.status(404).json({ error: 'Collection not found' });
  }

  return res.json(updated);
});

// GET collection members (owner/editor/viewer can view)
router.get('/:id/members', async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  const members = await listCollectionMembers(userId, req.params.id);
  if (!members) {
    return res.status(404).json({ error: 'Collection not found' });
  }

  return res.json(members);
});

// PUT add/update member role (owner only)
router.put('/:id/members', async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  const identifier = String(req.body.userId || req.body.identifier || '').trim();
  const role = req.body.role as CollectionMemberRole;

  if (!identifier) {
    return res.status(400).json({ error: 'userId/email/username is required' });
  }
  if (!['editor', 'viewer'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }

  const targetUserId = await resolveClerkUserId(identifier);
  if (!targetUserId) {
    return res.status(404).json({ error: 'User not found in Clerk' });
  }

  const members = await upsertCollectionMember(userId, req.params.id, targetUserId, role);
  if (!members) {
    return res.status(404).json({ error: 'Collection not found or not owner' });
  }

  return res.json(members);
});

// DELETE remove member (owner only)
router.delete('/:id/members/:userId', async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  const targetUserId = String(req.params.userId || '').trim();
  if (!targetUserId) {
    return res.status(400).json({ error: 'userId is required' });
  }

  const members = await removeCollectionMember(userId, req.params.id, targetUserId);
  if (!members) {
    return res.status(404).json({ error: 'Collection not found or not owner' });
  }

  return res.json(members);
});

// POST import collection (Postman/Bruno JSON)
router.post('/import', async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  const { data, format } = req.body;
  const now = new Date().toISOString();

  try {
    let imported: Collection | null = null;

    if (format === 'postman' && data.info) {
      // Postman v2.1 format
      imported = {
        id: uuidv4(),
        name: data.info.name || 'Imported Collection',
        description: data.info.description || '',
        requests: (data.item || [])
          .filter((item: Record<string, unknown>) => item.request)
          .map((item: Record<string, unknown>) => {
            const r = item.request as Record<string, unknown>;
            const url = typeof r.url === 'string' ? r.url : (r.url as Record<string, string>)?.raw || '';
            return {
              id: uuidv4(),
              name: item.name || 'Request',
              method: (r.method as string) || 'GET',
              url,
              params: [],
              headers: ((r.header as Array<Record<string, string>>) || []).map((h) => ({
                id: uuidv4(),
                key: h.key,
                value: h.value,
                enabled: true,
              })),
              body: { type: 'none' as const, content: '' },
              auth: { type: 'none' as const },
              createdAt: now,
              updatedAt: now,
            };
          }),
        folders: [],
        variables: [],
        sharing: {
          collection: { access: 'private', token: null },
          docs: { access: 'private', token: null },
        },
        ownerUserId: userId,
        storageScope: 'remote',
        createdAt: now,
        updatedAt: now,
      };
    } else {
      // Generic / Bruno format
      imported = {
        id: uuidv4(),
        name: data.name || 'Imported Collection',
        description: data.description || '',
        requests: (data.requests || []).map((r: Partial<ApiRequest>) => ({
          ...r,
          id: uuidv4(),
          createdAt: now,
          updatedAt: now,
        })),
        folders: data.folders || [],
        variables: data.variables || [],
        sharing: {
          collection: { access: 'private', token: null },
          docs: { access: 'private', token: null },
        },
        ownerUserId: userId,
        storageScope: 'remote',
        createdAt: now,
        updatedAt: now,
      };
    }

    if (imported) {
      const saved = await upsertCollection(userId, normalizeCollection(imported));
      return res.status(201).json(saved);
    }
  } catch (err) {
    return res.status(400).json({ error: 'Invalid import format: ' + (err as Error).message });
  }

  return res.status(400).json({ error: 'Unknown format' });
});

export default router;
