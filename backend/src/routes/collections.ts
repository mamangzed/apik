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

type ImportFormat = 'auto' | 'apik' | 'postman' | 'openapi' | 'insomnia' | 'har';
type UnknownRecord = Record<string, unknown>;
type ImportedCollectionDraft = {
  name: string;
  description: string;
  requests: Partial<ApiRequest>[];
  folders: Collection['folders'];
  variables: Collection['variables'];
};

const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
const MAX_IMPORTED_REQUESTS = 5000;
const ALLOWED_IMPORT_FORMATS = new Set<ImportFormat>(['auto', 'apik', 'postman', 'openapi', 'insomnia', 'har']);

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function normalizeImportFormat(value: unknown): ImportFormat {
  if (typeof value !== 'string') {
    return 'auto';
  }

  const lower = value.toLowerCase();
  const mapped = lower === 'apix' ? 'apik' : lower;
  return ALLOWED_IMPORT_FORMATS.has(mapped as ImportFormat) ? (mapped as ImportFormat) : 'auto';
}

function normalizeKeyValuePairs(values: unknown, keyField = 'key', valueField = 'value'): ApiRequest['params'] {
  return asArray<UnknownRecord>(values)
    .map((entry) => ({
      id: uuidv4(),
      key: asString(entry[keyField]),
      value: asString(entry[valueField]),
      description: asString(entry.description),
      enabled: entry.enabled !== false && entry.disabled !== true,
    }))
    .filter((entry) => entry.key.trim().length > 0 || entry.value.trim().length > 0);
}

function sanitizeMethod(method: unknown): ApiRequest['method'] {
  if (typeof method !== 'string') {
    return 'GET';
  }
  const upper = method.toUpperCase();
  return HTTP_METHODS.has(upper) ? (upper as ApiRequest['method']) : 'GET';
}

function detectImportFormat(data: unknown): Exclude<ImportFormat, 'auto'> {
  if (isRecord(data) && (typeof data.openapi === 'string' || typeof data.swagger === 'string')) {
    return 'openapi';
  }

  if (isRecord(data) && isRecord(data.info) && Array.isArray(data.item)) {
    return 'postman';
  }

  if (isRecord(data) && (data._type === 'export' || Array.isArray(data.resources))) {
    return 'insomnia';
  }

  if (isRecord(data) && isRecord(data.log) && Array.isArray(data.log.entries)) {
    return 'har';
  }

  return 'apik';
}

function parsePostmanUrl(urlField: unknown): string {
  if (typeof urlField === 'string') {
    return urlField;
  }

  if (!isRecord(urlField)) {
    return '';
  }

  if (typeof urlField.raw === 'string') {
    return urlField.raw;
  }

  const protocol = asString(urlField.protocol);
  const host = Array.isArray(urlField.host) ? urlField.host.join('.') : asString(urlField.host);
  const path = Array.isArray(urlField.path) ? urlField.path.join('/') : asString(urlField.path);
  const base = host ? `${protocol ? `${protocol}://` : ''}${host}` : '';

  if (!path) {
    return base;
  }

  return `${base}/${path}`;
}

function parsePostmanParams(urlField: unknown): ApiRequest['params'] {
  if (!isRecord(urlField)) {
    return [];
  }

  const fromQuery = normalizeKeyValuePairs(urlField.query);
  if (fromQuery.length > 0) {
    return fromQuery;
  }

  const raw = asString(urlField.raw);
  if (!raw) {
    return [];
  }

  try {
    const parsed = new URL(raw);
    const params: ApiRequest['params'] = [];
    parsed.searchParams.forEach((value, key) => {
      params.push({ id: uuidv4(), key, value, enabled: true });
    });
    return params;
  } catch {
    return [];
  }
}

function parsePostmanBody(rawBody: unknown): ApiRequest['body'] {
  if (!isRecord(rawBody)) {
    return { type: 'none', content: '' };
  }

  const mode = asString(rawBody.mode);
  if (mode === 'raw') {
    const options = isRecord(rawBody.options) ? rawBody.options : {};
    const rawOpt = isRecord(options.raw) ? options.raw : {};
    const language = asString(rawOpt.language).toLowerCase();
    const mime = asString(rawBody.mimeType).toLowerCase();
    const contentType = `${language} ${mime}`;
    const type: ApiRequest['body']['type'] = contentType.includes('json')
      ? 'json'
      : contentType.includes('xml')
        ? 'xml'
        : contentType.includes('graphql')
          ? 'graphql'
          : 'text';
    return { type, content: asString(rawBody.raw) };
  }

  if (mode === 'urlencoded') {
    return {
      type: 'form-urlencoded',
      content: '',
      formData: normalizeKeyValuePairs(rawBody.urlencoded),
    };
  }

  if (mode === 'formdata') {
    return {
      type: 'form-data',
      content: '',
      formData: normalizeKeyValuePairs(rawBody.formdata),
    };
  }

  if (mode === 'graphql') {
    const graphql = isRecord(rawBody.graphql) ? rawBody.graphql : {};
    return { type: 'graphql', content: asString(graphql.query) || asString(rawBody.graphql) };
  }

  return { type: 'none', content: '' };
}

function readPostmanAuthEntry(values: unknown, key: string): string {
  const entry = asArray<UnknownRecord>(values).find((item) => asString(item.key) === key);
  return asString(entry?.value);
}

function parsePostmanAuth(rawAuth: unknown): ApiRequest['auth'] {
  if (!isRecord(rawAuth)) {
    return { type: 'none' };
  }

  const type = asString(rawAuth.type).toLowerCase();
  if (type === 'bearer') {
    return { type: 'bearer', token: readPostmanAuthEntry(rawAuth.bearer, 'token') };
  }

  if (type === 'basic') {
    return {
      type: 'basic',
      username: readPostmanAuthEntry(rawAuth.basic, 'username'),
      password: readPostmanAuthEntry(rawAuth.basic, 'password'),
    };
  }

  if (type === 'apikey') {
    const addTo = readPostmanAuthEntry(rawAuth.apikey, 'in') === 'query' ? 'query' : 'header';
    return {
      type: 'api-key',
      key: readPostmanAuthEntry(rawAuth.apikey, 'key'),
      value: readPostmanAuthEntry(rawAuth.apikey, 'value'),
      addTo,
    };
  }

  return { type: 'none' };
}

function extractPostmanRequests(items: unknown, folderPrefix = ''): Partial<ApiRequest>[] {
  const requests: Partial<ApiRequest>[] = [];

  for (const item of asArray<unknown>(items)) {
    if (!isRecord(item)) {
      continue;
    }

    const itemName = asString(item.name, 'Request');
    const fullName = folderPrefix ? `${folderPrefix} / ${itemName}` : itemName;

    if (isRecord(item.request)) {
      const request = item.request;
      requests.push({
        name: fullName,
        method: sanitizeMethod(request.method),
        url: parsePostmanUrl(request.url),
        params: parsePostmanParams(request.url),
        headers: normalizeKeyValuePairs(request.header),
        body: parsePostmanBody(request.body),
        auth: parsePostmanAuth(request.auth),
        description: asString(item.description) || asString(request.description),
      });
      continue;
    }

    if (Array.isArray(item.item)) {
      requests.push(...extractPostmanRequests(item.item, fullName));
    }
  }

  return requests;
}

function joinUrl(baseUrl: string, pathName: string): string {
  const cleanBase = baseUrl.replace(/\/+$/, '');
  const cleanPath = pathName.startsWith('/') ? pathName : `/${pathName}`;
  return cleanBase ? `${cleanBase}${cleanPath}` : cleanPath;
}

function extractOpenApiExample(contentNode: unknown): string {
  if (!isRecord(contentNode)) {
    return '';
  }

  if (contentNode.example !== undefined) {
    return typeof contentNode.example === 'string'
      ? contentNode.example
      : JSON.stringify(contentNode.example, null, 2);
  }

  if (isRecord(contentNode.examples)) {
    const first = Object.values(contentNode.examples).find((entry) => isRecord(entry));
    if (isRecord(first) && first.value !== undefined) {
      return typeof first.value === 'string' ? first.value : JSON.stringify(first.value, null, 2);
    }
  }

  return '';
}

function parseOpenApiBody(rawBody: unknown): ApiRequest['body'] {
  if (!isRecord(rawBody) || !isRecord(rawBody.content)) {
    return { type: 'none', content: '' };
  }

  const content = rawBody.content as UnknownRecord;
  const byMime = (mime: string) => content[mime];

  const json = byMime('application/json');
  if (json !== undefined) {
    return { type: 'json', content: extractOpenApiExample(json) };
  }

  const formUrl = byMime('application/x-www-form-urlencoded');
  if (formUrl !== undefined) {
    return { type: 'form-urlencoded', content: extractOpenApiExample(formUrl) };
  }

  const formData = byMime('multipart/form-data');
  if (formData !== undefined) {
    return { type: 'form-data', content: extractOpenApiExample(formData) };
  }

  const xml = byMime('application/xml') ?? byMime('text/xml');
  if (xml !== undefined) {
    return { type: 'xml', content: extractOpenApiExample(xml) };
  }

  const text = byMime('text/plain');
  if (text !== undefined) {
    return { type: 'text', content: extractOpenApiExample(text) };
  }

  const firstNode = Object.values(content)[0];
  return { type: 'text', content: extractOpenApiExample(firstNode) };
}

function parseOpenApiParams(pathParams: unknown, operationParams: unknown, location: 'query' | 'header'): ApiRequest['params'] {
  const merged = [...asArray<UnknownRecord>(pathParams), ...asArray<UnknownRecord>(operationParams)];
  return merged
    .filter((entry) => asString(entry.in) === location)
    .map((entry) => ({
      id: uuidv4(),
      key: asString(entry.name),
      value: '',
      description: asString(entry.description),
      enabled: true,
    }))
    .filter((entry) => entry.key.trim().length > 0);
}

function extractOpenApiCollection(data: unknown): ImportedCollectionDraft {
  const doc = isRecord(data) ? data : {};
  const info = isRecord(doc.info) ? doc.info : {};
  const paths = isRecord(doc.paths) ? doc.paths : {};
  const servers = asArray<UnknownRecord>(doc.servers);
  const baseUrl = asString(servers[0]?.url);

  const requests: Partial<ApiRequest>[] = [];
  const methods = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];

  for (const [pathName, pathItemRaw] of Object.entries(paths)) {
    if (!isRecord(pathItemRaw)) {
      continue;
    }

    const pathParams = pathItemRaw.parameters;

    for (const method of methods) {
      const operation = pathItemRaw[method];
      if (!isRecord(operation)) {
        continue;
      }

      const methodUpper = sanitizeMethod(method);
      requests.push({
        name: asString(operation.summary) || asString(operation.operationId) || `${methodUpper} ${pathName}`,
        method: methodUpper,
        url: joinUrl(baseUrl, pathName),
        params: parseOpenApiParams(pathParams, operation.parameters, 'query'),
        headers: parseOpenApiParams(pathParams, operation.parameters, 'header'),
        body: parseOpenApiBody(operation.requestBody),
        auth: { type: 'none' },
        description: asString(operation.description),
      });
    }
  }

  return {
    name: asString(info.title, 'OpenAPI Collection'),
    description: asString(info.description),
    requests,
    folders: [] as Collection['folders'],
    variables: [] as Collection['variables'],
  };
}

function extractInsomniaCollection(data: unknown): ImportedCollectionDraft {
  const doc = isRecord(data) ? data : {};
  const resources = asArray<UnknownRecord>(doc.resources);
  const workspace = resources.find((resource) => resource._type === 'workspace');

  const requests: Partial<ApiRequest>[] = resources
    .filter((resource) => resource._type === 'request')
    .map((resource, index) => {
      const bodyNode = isRecord(resource.body) ? resource.body : {};
      const mimeType = asString(bodyNode.mimeType).toLowerCase();
      const textBody = asString(bodyNode.text);

      let body: ApiRequest['body'] = { type: 'none', content: '' };
      if (textBody) {
        body = {
          type: mimeType.includes('json')
            ? 'json'
            : mimeType.includes('xml')
              ? 'xml'
              : mimeType.includes('x-www-form-urlencoded')
                ? 'form-urlencoded'
                : 'text',
          content: textBody,
        };
      }

      let auth: ApiRequest['auth'] = { type: 'none' };
      const authentication = isRecord(resource.authentication) ? resource.authentication : {};
      const authType = asString(authentication.type).toLowerCase();
      if (authType === 'bearer') {
        auth = { type: 'bearer', token: asString(authentication.token) };
      } else if (authType === 'basic') {
        auth = {
          type: 'basic',
          username: asString(authentication.username),
          password: asString(authentication.password),
        };
      }

      return {
        name: asString(resource.name, `Request ${index + 1}`),
        method: sanitizeMethod(resource.method),
        url: asString(resource.url),
        params: normalizeKeyValuePairs(resource.parameters, 'name', 'value'),
        headers: normalizeKeyValuePairs(resource.headers, 'name', 'value'),
        body,
        auth,
        description: '',
      };
    });

  return {
    name: asString(workspace?.name, 'Imported Insomnia Collection'),
    description: '',
    requests,
    folders: [] as Collection['folders'],
    variables: [] as Collection['variables'],
  };
}

function extractHarCollection(data: unknown): ImportedCollectionDraft {
  const doc = isRecord(data) ? data : {};
  const log = isRecord(doc.log) ? doc.log : {};
  const entries = asArray<UnknownRecord>(log.entries);

  const requests: Partial<ApiRequest>[] = entries
    .map((entry, index) => {
      const request = isRecord(entry.request) ? entry.request : {};
      const url = asString(request.url);
      const method = sanitizeMethod(request.method);
      let pathName = url;
      try {
        pathName = new URL(url).pathname;
      } catch {
        // Keep the original value when URL parsing fails.
      }

      const headers = normalizeKeyValuePairs(request.headers, 'name', 'value');
      const postData = isRecord(request.postData) ? request.postData : {};
      const contentTypeFromPostData = asString(postData.mimeType).toLowerCase();
      const contentTypeFromHeader = headers.find((entry) => entry.key.toLowerCase() === 'content-type')?.value.toLowerCase() || '';
      const contentType = contentTypeFromHeader || contentTypeFromPostData;

      const postBodyText = asString(postData.text);
      const body: ApiRequest['body'] = postBodyText
        ? {
            type: contentType.includes('json')
              ? 'json'
              : contentType.includes('xml')
                ? 'xml'
                : contentType.includes('x-www-form-urlencoded')
                  ? 'form-urlencoded'
                  : contentType.includes('multipart/form-data')
                    ? 'form-data'
                    : 'text',
            content: postBodyText,
          }
        : { type: 'none', content: '' };

      return {
        name: `${method} ${pathName || `request-${index + 1}`}`,
        method,
        url,
        params: normalizeKeyValuePairs(request.queryString, 'name', 'value'),
        headers,
        body,
        auth: { type: 'none' as const },
      };
    })
    .filter((request) => asString(request.url).length > 0);

  return {
    name: 'Imported HAR Collection',
    description: '',
    requests,
    folders: [] as Collection['folders'],
    variables: [] as Collection['variables'],
  };
}

function normalizeImportedRequest(raw: Partial<ApiRequest> | UnknownRecord, index: number, now: string): ApiRequest {
  const source = isRecord(raw) ? raw : {};
  const paramsSource = asArray<UnknownRecord>(source.params);
  const headersSource = asArray<UnknownRecord>(source.headers);
  const bodySource = isRecord(source.body) ? source.body : {};
  const authSource = isRecord(source.auth) ? source.auth : {};
  const allowedBodyTypes = new Set(['none', 'json', 'form-data', 'form-urlencoded', 'xml', 'text', 'binary', 'graphql']);
  const allowedAuthTypes = new Set(['none', 'bearer', 'basic', 'api-key', 'oauth2']);

  return {
    id: uuidv4(),
    name: asString(source.name, `Request ${index + 1}`),
    method: sanitizeMethod(source.method),
    url: asString(source.url),
    params: paramsSource.map((entry) => ({
      id: uuidv4(),
      key: asString(entry.key),
      value: asString(entry.value),
      description: asString(entry.description),
      enabled: entry.enabled !== false,
    })),
    headers: headersSource.map((entry) => ({
      id: uuidv4(),
      key: asString(entry.key),
      value: asString(entry.value),
      description: asString(entry.description),
      enabled: entry.enabled !== false,
    })),
    body: {
      type: allowedBodyTypes.has(asString(bodySource.type))
        ? (asString(bodySource.type) as ApiRequest['body']['type'])
        : 'none',
      content: asString(bodySource.content),
      formData: asArray<UnknownRecord>(bodySource.formData).map((entry) => ({
        id: uuidv4(),
        key: asString(entry.key),
        value: asString(entry.value),
        description: asString(entry.description),
        enabled: entry.enabled !== false,
      })),
    },
    auth: {
      type: allowedAuthTypes.has(asString(authSource.type))
        ? (asString(authSource.type) as ApiRequest['auth']['type'])
        : 'none',
      token: asString(authSource.token),
      username: asString(authSource.username),
      password: asString(authSource.password),
      key: asString(authSource.key),
      value: asString(authSource.value),
      addTo: authSource.addTo === 'query' ? 'query' : 'header',
    },
    preRequestScript: asString(source.preRequestScript),
    testScript: asString(source.testScript),
    description: asString(source.description),
    createdAt: now,
    updatedAt: now,
  };
}

function buildImportedCollection(data: unknown, format: ImportFormat, userId: string, now: string): Collection {
  const detectedFormat = format === 'auto' ? detectImportFormat(data) : format;
  const payload = isRecord(data) ? data : {};

  let parsed: ImportedCollectionDraft;
  if (detectedFormat === 'postman') {
    const info = isRecord(payload.info) ? payload.info : {};
    parsed = {
      name: asString(info.name, 'Imported Collection'),
      description: asString(info.description),
      requests: extractPostmanRequests(payload.item),
      folders: [] as Collection['folders'],
      variables: [] as Collection['variables'],
    };
  } else if (detectedFormat === 'openapi') {
    parsed = extractOpenApiCollection(payload);
  } else if (detectedFormat === 'insomnia') {
    parsed = extractInsomniaCollection(payload);
  } else if (detectedFormat === 'har') {
    parsed = extractHarCollection(payload);
  } else {
    parsed = {
      name: asString(payload.name, 'Imported Collection'),
      description: asString(payload.description),
      requests: asArray<Partial<ApiRequest>>(payload.requests),
      folders: asArray<Collection['folders'][number]>(payload.folders),
      variables: normalizeKeyValuePairs(payload.variables),
    };
  }

  const sourceRequests = parsed.requests;
  if (sourceRequests.length > MAX_IMPORTED_REQUESTS) {
    throw new Error(`Import exceeds limit (${MAX_IMPORTED_REQUESTS} requests)`);
  }

  const normalizedRequests = asArray<Partial<ApiRequest>>(parsed.requests)
    .map((request, index) => normalizeImportedRequest(request, index, now))
    .filter((request) => request.url.trim().length > 0 || request.name.trim().length > 0);

  if (normalizedRequests.length === 0) {
    throw new Error('No requests found in import data');
  }

  return {
    id: uuidv4(),
    name: asString(parsed.name, 'Imported Collection'),
    description: asString(parsed.description),
    requests: normalizedRequests,
    folders: asArray(parsed.folders),
    variables: normalizeKeyValuePairs(parsed.variables),
    sharing: {
      collection: { access: 'private', token: null },
      docs: { access: 'private', token: null },
      form: { access: 'private', token: null },
    },
    ownerUserId: userId,
    storageScope: 'remote',
    createdAt: now,
    updatedAt: now,
  };
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
      form: { access: 'private', token: null },
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
    formConfig: req.body.formConfig,
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
  const target = req.body.target as 'collection' | 'docs' | 'form';
  const access = req.body.access as VisibilityMode;

  if (!['collection', 'docs', 'form'].includes(target)) {
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

  if (data === undefined || data === null || typeof data !== 'object') {
    return res.status(400).json({ error: 'Import payload must include object data' });
  }

  try {
    const selectedFormat = normalizeImportFormat(format);
    const imported = buildImportedCollection(data, selectedFormat, userId, now);
    const saved = await upsertCollection(userId, normalizeCollection(imported));
    return res.status(201).json(saved);
  } catch (err) {
    return res.status(400).json({ error: 'Invalid import format: ' + (err as Error).message });
  }
});

export default router;
