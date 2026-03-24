import { parse as parseYaml } from 'yaml';
import { ApiRequest, Collection, HttpMethod, KeyValuePair } from '../types';

export type ImportSourceFormat = 'auto' | 'apik' | 'postman' | 'openapi' | 'insomnia' | 'har';
export type ExportTargetFormat = 'apik' | 'postman' | 'openapi';

type UnknownRecord = Record<string, unknown>;

const HTTP_METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const HTTP_METHOD_SET = new Set<HttpMethod>(HTTP_METHODS);

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function sanitizeMethod(method: unknown): HttpMethod {
  if (typeof method !== 'string') {
    return 'GET';
  }
  const upper = method.toUpperCase() as HttpMethod;
  return HTTP_METHOD_SET.has(upper) ? upper : 'GET';
}

function toSlug(input: string): string {
  const slug = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'collection';
}

function parseStructuredText(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error('File is empty');
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    try {
      return parseYaml(trimmed);
    } catch (yamlError) {
      throw new Error(`Invalid JSON/YAML: ${(yamlError as Error).message}`);
    }
  }
}

function detectImportFormat(value: unknown): Exclude<ImportSourceFormat, 'auto'> {
  if (isOpenApiPayload(value)) return 'openapi';
  if (isPostmanPayload(value)) return 'postman';
  if (isInsomniaPayload(value)) return 'insomnia';
  if (isHarPayload(value)) return 'har';
  return 'apik';
}

function isOpenApiPayload(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return typeof value.openapi === 'string' || typeof value.swagger === 'string';
}

function isPostmanPayload(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return isRecord(value.info) && Array.isArray(value.item);
}

function isInsomniaPayload(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value._type === 'export') return true;
  return Array.isArray(value.resources);
}

function isHarPayload(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (!isRecord(value.log)) return false;
  return Array.isArray(value.log.entries);
}

function normalizeKeyValuePairs(values: unknown): KeyValuePair[] {
  return asArray(values)
    .filter((entry) => isRecord(entry))
    .map((entry, index) => ({
      id: asString(entry.id, `kv-${index + 1}`),
      key: asString(entry.key),
      value: asString(entry.value),
      description: asString(entry.description),
      enabled: entry.enabled !== false,
    }))
    .filter((entry) => entry.key.trim().length > 0 || entry.value.trim().length > 0);
}

function normalizeBody(rawBody: unknown): ApiRequest['body'] {
  if (!isRecord(rawBody)) {
    return { type: 'none', content: '' };
  }

  const type = asString(rawBody.type, 'none');
  const allowed = new Set(['none', 'json', 'form-data', 'form-urlencoded', 'xml', 'text', 'graphql', 'binary']);

  return {
    type: allowed.has(type) ? (type as ApiRequest['body']['type']) : 'none',
    content: asString(rawBody.content),
    formData: normalizeKeyValuePairs(rawBody.formData),
  };
}

function normalizeAuth(rawAuth: unknown): ApiRequest['auth'] {
  if (!isRecord(rawAuth)) {
    return { type: 'none' };
  }

  const type = asString(rawAuth.type, 'none');
  const allowed = new Set(['none', 'bearer', 'basic', 'api-key', 'oauth2']);
  const safeType = allowed.has(type) ? (type as ApiRequest['auth']['type']) : 'none';

  return {
    type: safeType,
    token: asString(rawAuth.token),
    username: asString(rawAuth.username),
    password: asString(rawAuth.password),
    key: asString(rawAuth.key),
    value: asString(rawAuth.value),
    addTo: rawAuth.addTo === 'query' ? 'query' : 'header',
  };
}

function normalizeApiRequest(raw: unknown, fallbackName: string): ApiRequest {
  const now = new Date().toISOString();
  const request = isRecord(raw) ? raw : {};
  const id = asString(request.id).trim() || `${toSlug(fallbackName)}-${Math.random().toString(36).slice(2, 10)}`;

  return {
    id,
    name: asString(request.name, fallbackName),
    method: sanitizeMethod(request.method),
    url: asString(request.url),
    params: normalizeKeyValuePairs(request.params),
    headers: normalizeKeyValuePairs(request.headers),
    body: normalizeBody(request.body),
    auth: normalizeAuth(request.auth),
    preRequestScript: asString(request.preRequestScript),
    testScript: asString(request.testScript),
    description: asString(request.description),
    createdAt: asString(request.createdAt, now),
    updatedAt: asString(request.updatedAt, now),
  };
}

function readPostmanUrl(urlField: unknown): string {
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
  return path ? `${base}/${path}` : base;
}

function readPostmanAuth(rawAuth: unknown): ApiRequest['auth'] {
  if (!isRecord(rawAuth)) {
    return { type: 'none' };
  }

  const type = asString(rawAuth.type);
  if (type === 'bearer') {
    const tokenEntry = asArray<UnknownRecord>(rawAuth.bearer).find((entry) => entry.key === 'token');
    return { type: 'bearer', token: asString(tokenEntry?.value) };
  }

  if (type === 'basic') {
    const username = asArray<UnknownRecord>(rawAuth.basic).find((entry) => entry.key === 'username');
    const password = asArray<UnknownRecord>(rawAuth.basic).find((entry) => entry.key === 'password');
    return { type: 'basic', username: asString(username?.value), password: asString(password?.value) };
  }

  if (type === 'apikey') {
    const keyEntry = asArray<UnknownRecord>(rawAuth.apikey).find((entry) => entry.key === 'key');
    const valueEntry = asArray<UnknownRecord>(rawAuth.apikey).find((entry) => entry.key === 'value');
    const inEntry = asArray<UnknownRecord>(rawAuth.apikey).find((entry) => entry.key === 'in');
    return {
      type: 'api-key',
      key: asString(keyEntry?.value),
      value: asString(valueEntry?.value),
      addTo: asString(inEntry?.value) === 'query' ? 'query' : 'header',
    };
  }

  return { type: 'none' };
}

function readPostmanBody(rawBody: unknown): ApiRequest['body'] {
  if (!isRecord(rawBody)) {
    return { type: 'none', content: '' };
  }

  const mode = asString(rawBody.mode);
  if (mode === 'raw') {
    const contentType = asString((isRecord(rawBody.options) ? rawBody.options.raw : undefined) as unknown);
    const type = contentType.includes('xml') ? 'xml' : contentType.includes('json') ? 'json' : 'text';
    return { type, content: asString(rawBody.raw) };
  }

  if (mode === 'urlencoded') {
    return {
      type: 'form-urlencoded',
      content: '',
      formData: asArray<UnknownRecord>(rawBody.urlencoded).map((entry, index) => ({
        id: `urlencoded-${index + 1}`,
        key: asString(entry.key),
        value: asString(entry.value),
        enabled: entry.disabled !== true,
      })),
    };
  }

  if (mode === 'formdata') {
    return {
      type: 'form-data',
      content: '',
      formData: asArray<UnknownRecord>(rawBody.formdata).map((entry, index) => ({
        id: `formdata-${index + 1}`,
        key: asString(entry.key),
        value: asString(entry.value),
        enabled: entry.disabled !== true,
      })),
    };
  }

  if (mode === 'graphql') {
    return {
      type: 'graphql',
      content: asString(rawBody.graphql),
    };
  }

  return { type: 'none', content: '' };
}

function extractPostmanRequests(items: unknown, folderPrefix = ''): ApiRequest[] {
  const requests: ApiRequest[] = [];

  for (const item of asArray<unknown>(items)) {
    if (!isRecord(item)) {
      continue;
    }

    const itemName = asString(item.name, 'Request');
    const fullName = folderPrefix ? `${folderPrefix} / ${itemName}` : itemName;

    if (isRecord(item.request)) {
      const request = item.request;
      requests.push(
        normalizeApiRequest(
          {
            name: fullName,
            method: sanitizeMethod(request.method),
            url: readPostmanUrl(request.url),
            params: [],
            headers: asArray<UnknownRecord>(request.header).map((header, index) => ({
              id: `header-${index + 1}`,
              key: asString(header.key),
              value: asString(header.value),
              enabled: header.disabled !== true,
              description: asString(header.description),
            })),
            body: readPostmanBody(request.body),
            auth: readPostmanAuth(request.auth),
            description: asString(item.description) || asString(request.description),
          },
          fullName,
        ),
      );
      continue;
    }

    if (Array.isArray(item.item)) {
      requests.push(...extractPostmanRequests(item.item, fullName));
    }
  }

  return requests;
}

function extractExample(mediaType: unknown): string {
  if (!isRecord(mediaType)) {
    return '';
  }

  if (mediaType.example !== undefined) {
    return typeof mediaType.example === 'string' ? mediaType.example : JSON.stringify(mediaType.example, null, 2);
  }

  if (isRecord(mediaType.examples)) {
    const first = Object.values(mediaType.examples).find((entry) => isRecord(entry));
    if (isRecord(first) && first.value !== undefined) {
      return typeof first.value === 'string' ? first.value : JSON.stringify(first.value, null, 2);
    }
  }

  if (isRecord(mediaType.schema) && mediaType.schema.example !== undefined) {
    return typeof mediaType.schema.example === 'string'
      ? mediaType.schema.example
      : JSON.stringify(mediaType.schema.example, null, 2);
  }

  return '';
}

function mergeOpenApiParams(pathParams: unknown, operationParams: unknown): KeyValuePair[] {
  const params = [...asArray(pathParams), ...asArray(operationParams)]
    .filter((entry) => isRecord(entry) && asString(entry.in) === 'query')
    .map((entry, index) => ({
      id: `param-${index + 1}`,
      key: asString((entry as UnknownRecord).name),
      value: '',
      enabled: true,
      description: asString((entry as UnknownRecord).description),
    }));

  return params;
}

function mergeOpenApiHeaders(pathParams: unknown, operationParams: unknown): KeyValuePair[] {
  const params = [...asArray(pathParams), ...asArray(operationParams)]
    .filter((entry) => isRecord(entry) && asString(entry.in) === 'header')
    .map((entry, index) => ({
      id: `header-${index + 1}`,
      key: asString((entry as UnknownRecord).name),
      value: '',
      enabled: true,
      description: asString((entry as UnknownRecord).description),
    }));

  return params;
}

function readOpenApiRequestBody(rawBody: unknown): ApiRequest['body'] {
  if (!isRecord(rawBody) || !isRecord(rawBody.content)) {
    return { type: 'none', content: '' };
  }

  const jsonType = rawBody.content['application/json'];
  if (jsonType !== undefined) {
    return { type: 'json', content: extractExample(jsonType) };
  }

  const formType = rawBody.content['application/x-www-form-urlencoded'];
  if (formType !== undefined) {
    return { type: 'form-urlencoded', content: extractExample(formType) };
  }

  const multipartType = rawBody.content['multipart/form-data'];
  if (multipartType !== undefined) {
    return { type: 'form-data', content: extractExample(multipartType) };
  }

  const xmlType = rawBody.content['application/xml'] ?? rawBody.content['text/xml'];
  if (xmlType !== undefined) {
    return { type: 'xml', content: extractExample(xmlType) };
  }

  const textType = rawBody.content['text/plain'];
  if (textType !== undefined) {
    return { type: 'text', content: extractExample(textType) };
  }

  const firstType = Object.values(rawBody.content)[0];
  return { type: 'text', content: extractExample(firstType) };
}

function readOpenApiAuth(operation: UnknownRecord, document: UnknownRecord): ApiRequest['auth'] {
  const operationSecurity = asArray<UnknownRecord>(operation.security);
  const globalSecurity = asArray<UnknownRecord>(document.security);
  const selectedSecurity = operationSecurity.length > 0 ? operationSecurity : globalSecurity;

  if (selectedSecurity.length === 0) {
    return { type: 'none' };
  }

  const firstRequirement = selectedSecurity[0];
  const schemeName = Object.keys(firstRequirement)[0];
  if (!schemeName) {
    return { type: 'none' };
  }

  const components = isRecord(document.components) ? document.components : {};
  const securitySchemes = isRecord(components.securitySchemes) ? components.securitySchemes : {};
  const scheme = isRecord(securitySchemes[schemeName]) ? securitySchemes[schemeName] : null;

  if (!scheme) {
    return { type: 'none' };
  }

  if (asString(scheme.type) === 'http' && asString(scheme.scheme).toLowerCase() === 'bearer') {
    return { type: 'bearer' };
  }

  if (asString(scheme.type) === 'http' && asString(scheme.scheme).toLowerCase() === 'basic') {
    return { type: 'basic' };
  }

  if (asString(scheme.type) === 'apiKey') {
    return {
      type: 'api-key',
      key: asString(scheme.name),
      value: '',
      addTo: asString(scheme.in) === 'query' ? 'query' : 'header',
    };
  }

  if (asString(scheme.type) === 'oauth2') {
    return { type: 'oauth2' };
  }

  return { type: 'none' };
}

function joinUrl(baseUrl: string, pathName: string): string {
  const cleanBase = baseUrl.replace(/\/+$/, '');
  const cleanPath = pathName.startsWith('/') ? pathName : `/${pathName}`;
  return cleanBase ? `${cleanBase}${cleanPath}` : cleanPath;
}

function parseOpenApiCollection(data: unknown, fallbackName: string): Partial<Collection> {
  const doc = isRecord(data) ? data : {};
  const info = isRecord(doc.info) ? doc.info : {};
  const servers = asArray<UnknownRecord>(doc.servers);
  const baseUrl = asString(servers[0]?.url);

  const requests: ApiRequest[] = [];
  const paths = isRecord(doc.paths) ? doc.paths : {};

  for (const [pathName, pathItemRaw] of Object.entries(paths)) {
    if (!isRecord(pathItemRaw)) {
      continue;
    }

    const pathParams = pathItemRaw.parameters;

    for (const method of ['get', 'post', 'put', 'patch', 'delete', 'head', 'options']) {
      const operation = pathItemRaw[method];
      if (!isRecord(operation)) {
        continue;
      }

      const methodUpper = method.toUpperCase() as HttpMethod;
      const operationId = asString(operation.operationId);
      const summary = asString(operation.summary);
      const description = asString(operation.description);

      const requestName = summary || operationId || `${methodUpper} ${pathName}`;
      requests.push(
        normalizeApiRequest(
          {
            name: requestName,
            method: methodUpper,
            url: joinUrl(baseUrl, pathName),
            params: mergeOpenApiParams(pathParams, operation.parameters),
            headers: mergeOpenApiHeaders(pathParams, operation.parameters),
            body: readOpenApiRequestBody(operation.requestBody),
            auth: readOpenApiAuth(operation, doc),
            description,
          },
          requestName,
        ),
      );
    }
  }

  return {
    name: asString(info.title, fallbackName || 'OpenAPI Collection'),
    description: asString(info.description),
    requests,
    folders: [],
    variables: [],
  };
}

function parseInsomniaCollection(data: unknown, fallbackName: string): Partial<Collection> {
  const doc = isRecord(data) ? data : {};
  const resources = asArray<UnknownRecord>(doc.resources);

  const byId = new Map<string, UnknownRecord>();
  resources.forEach((resource) => {
    const id = asString(resource._id);
    if (id) {
      byId.set(id, resource);
    }
  });

  const resolveGroupName = (parentId: string | undefined): string => {
    if (!parentId) {
      return '';
    }

    const parent = byId.get(parentId);
    if (!parent) {
      return '';
    }

    if (parent._type === 'request_group') {
      const parentPath = resolveGroupName(asString(parent.parentId));
      const own = asString(parent.name);
      return parentPath ? `${parentPath} / ${own}` : own;
    }

    return resolveGroupName(asString(parent.parentId));
  };

  const requests: ApiRequest[] = resources
    .filter((resource) => resource._type === 'request')
    .map((request, index) => {
      const folderPrefix = resolveGroupName(asString(request.parentId));
      const requestName = asString(request.name, `Request ${index + 1}`);
      const name = folderPrefix ? `${folderPrefix} / ${requestName}` : requestName;

      const headers = asArray<UnknownRecord>(request.headers).map((entry, headerIndex) => ({
        id: `header-${headerIndex + 1}`,
        key: asString(entry.name),
        value: asString(entry.value),
        enabled: entry.disabled !== true,
      }));

      let body: ApiRequest['body'] = { type: 'none', content: '' };
      if (isRecord(request.body)) {
        const bodyData = request.body;
        const mimeType = asString(bodyData.mimeType).toLowerCase();
        if (mimeType.includes('json')) {
          body = { type: 'json', content: asString(bodyData.text) };
        } else if (mimeType.includes('xml')) {
          body = { type: 'xml', content: asString(bodyData.text) };
        } else if (mimeType.includes('x-www-form-urlencoded')) {
          body = { type: 'form-urlencoded', content: asString(bodyData.text) };
        } else if (asString(bodyData.text)) {
          body = { type: 'text', content: asString(bodyData.text) };
        }
      }

      let auth: ApiRequest['auth'] = { type: 'none' };
      if (isRecord(request.authentication)) {
        const authData = request.authentication;
        const authType = asString(authData.type);
        if (authType === 'bearer') {
          auth = { type: 'bearer', token: asString(authData.token) };
        } else if (authType === 'basic') {
          auth = { type: 'basic', username: asString(authData.username), password: asString(authData.password) };
        }
      }

      return normalizeApiRequest(
        {
          name,
          method: sanitizeMethod(request.method),
          url: asString(request.url),
          params: asArray<UnknownRecord>(request.parameters).map((entry, paramIndex) => ({
            id: `param-${paramIndex + 1}`,
            key: asString(entry.name),
            value: asString(entry.value),
            enabled: entry.disabled !== true,
          })),
          headers,
          body,
          auth,
        },
        name,
      );
    });

  const workspace = resources.find((resource) => resource._type === 'workspace');

  return {
    name: asString(workspace?.name, fallbackName || 'Imported Insomnia Collection'),
    description: '',
    requests,
    folders: [],
    variables: [],
  };
}

function inferBodyTypeFromContentType(contentType: string): ApiRequest['body']['type'] {
  const value = contentType.toLowerCase();
  if (value.includes('application/json')) return 'json';
  if (value.includes('xml')) return 'xml';
  if (value.includes('x-www-form-urlencoded')) return 'form-urlencoded';
  if (value.includes('multipart/form-data')) return 'form-data';
  if (value.includes('graphql')) return 'graphql';
  if (value.includes('text/')) return 'text';
  return 'text';
}

function parseHarCollection(data: unknown, fallbackName: string): Partial<Collection> {
  const doc = isRecord(data) ? data : {};
  const log = isRecord(doc.log) ? doc.log : {};
  const entries = asArray<UnknownRecord>(log.entries);

  const requests: ApiRequest[] = entries
    .map((entry, index) => {
      const request = isRecord(entry.request) ? entry.request : {};
      const url = asString(request.url);
      const method = sanitizeMethod(request.method);

      let pathName = url;
      try {
        pathName = new URL(url).pathname;
      } catch {
        // Keep original value for malformed URLs.
      }

      const headers = asArray<UnknownRecord>(request.headers).map((header, headerIndex) => ({
        id: `header-${headerIndex + 1}`,
        key: asString(header.name),
        value: asString(header.value),
        enabled: true,
      }));

      const queryParams = asArray<UnknownRecord>(request.queryString).map((param, paramIndex) => ({
        id: `param-${paramIndex + 1}`,
        key: asString(param.name),
        value: asString(param.value),
        enabled: true,
      }));

      const postData = isRecord(request.postData) ? request.postData : null;
      const contentTypeHeader = headers.find((header) => header.key.toLowerCase() === 'content-type');
      const contentType = contentTypeHeader?.value || asString(postData?.mimeType);

      const body: ApiRequest['body'] = postData
        ? {
            type: inferBodyTypeFromContentType(contentType),
            content: asString(postData.text),
          }
        : { type: 'none', content: '' };

      const requestName = `${method} ${pathName || `request-${index + 1}`}`;
      return normalizeApiRequest(
        {
          name: requestName,
          method,
          url,
          params: queryParams,
          headers,
          body,
          auth: { type: 'none' as const },
        },
        requestName,
      );
    })
    .filter((request) => asString(request.url).length > 0);

  const creator = isRecord(log.creator) ? log.creator : {};
  const browser = isRecord(log.browser) ? log.browser : {};

  return {
    name: fallbackName || 'Imported HAR Collection',
    description: [asString(creator.name), asString(browser.name)].filter(Boolean).join(' / '),
    requests,
    folders: [],
    variables: [],
  };
}

function parseApikCollection(data: unknown, fallbackName: string): Partial<Collection> {
  const payload = isRecord(data) ? data : {};

  const requests = asArray(payload.requests).map((request, index) => normalizeApiRequest(request, `Request ${index + 1}`));

  return {
    name: asString(payload.name, fallbackName || 'Imported Collection'),
    description: asString(payload.description),
    requests,
    folders: asArray(payload.folders),
    variables: normalizeKeyValuePairs(payload.variables),
  };
}

export function parseCollectionImport(
  fileContent: string,
  selectedFormat: ImportSourceFormat,
  fallbackName = 'Imported Collection',
): { detectedFormat: Exclude<ImportSourceFormat, 'auto'>; collection: Partial<Collection> } {
  const parsed = parseStructuredText(fileContent);
  const detectedFormat = selectedFormat === 'auto' ? detectImportFormat(parsed) : selectedFormat;

  let collection: Partial<Collection>;
  if (detectedFormat === 'postman') {
    const payload = isRecord(parsed) ? parsed : {};
    const info = isRecord(payload.info) ? payload.info : {};
    collection = {
      name: asString(info.name, fallbackName),
      description: asString(info.description),
      requests: extractPostmanRequests(payload.item),
      folders: [],
      variables: [],
    };
  } else if (detectedFormat === 'openapi') {
    collection = parseOpenApiCollection(parsed, fallbackName);
  } else if (detectedFormat === 'insomnia') {
    collection = parseInsomniaCollection(parsed, fallbackName);
  } else if (detectedFormat === 'har') {
    collection = parseHarCollection(parsed, fallbackName);
  } else {
    collection = parseApikCollection(parsed, fallbackName);
  }

  const normalizedRequests = asArray(collection.requests)
    .map((request, index) => normalizeApiRequest(request, `Request ${index + 1}`))
    .filter((request) => asString(request.url).length > 0 || asString(request.name).length > 0);

  if (normalizedRequests.length === 0) {
    throw new Error('No requests found in import file');
  }

  return {
    detectedFormat,
    collection: {
      ...collection,
      name: asString(collection.name, fallbackName),
      description: asString(collection.description),
      requests: normalizedRequests,
      folders: asArray(collection.folders),
      variables: normalizeKeyValuePairs(collection.variables),
    },
  };
}

function toPostmanUrl(url: string): string {
  return url || '{{baseUrl}}';
}

function toPostmanHeaders(headers: KeyValuePair[]): Array<Record<string, unknown>> {
  return headers.map((header) => ({
    key: header.key,
    value: header.value,
    type: 'text',
    disabled: header.enabled === false,
    description: header.description,
  }));
}

function toPostmanBody(request: ApiRequest): Record<string, unknown> | undefined {
  if (request.body.type === 'none') {
    return undefined;
  }

  if (request.body.type === 'json' || request.body.type === 'xml' || request.body.type === 'text' || request.body.type === 'graphql') {
    return {
      mode: 'raw',
      raw: request.body.content,
    };
  }

  if (request.body.type === 'form-urlencoded') {
    return {
      mode: 'urlencoded',
      urlencoded: (request.body.formData || []).map((entry) => ({
        key: entry.key,
        value: entry.value,
        disabled: entry.enabled === false,
      })),
    };
  }

  if (request.body.type === 'form-data') {
    return {
      mode: 'formdata',
      formdata: (request.body.formData || []).map((entry) => ({
        key: entry.key,
        value: entry.value,
        type: 'text',
        disabled: entry.enabled === false,
      })),
    };
  }

  return {
    mode: 'raw',
    raw: request.body.content,
  };
}

function toPostmanAuth(auth: ApiRequest['auth']): Record<string, unknown> | undefined {
  if (auth.type === 'none') {
    return undefined;
  }

  if (auth.type === 'bearer') {
    return {
      type: 'bearer',
      bearer: [{ key: 'token', value: auth.token || '', type: 'string' }],
    };
  }

  if (auth.type === 'basic') {
    return {
      type: 'basic',
      basic: [
        { key: 'username', value: auth.username || '', type: 'string' },
        { key: 'password', value: auth.password || '', type: 'string' },
      ],
    };
  }

  if (auth.type === 'api-key') {
    return {
      type: 'apikey',
      apikey: [
        { key: 'key', value: auth.key || '', type: 'string' },
        { key: 'value', value: auth.value || '', type: 'string' },
        { key: 'in', value: auth.addTo === 'query' ? 'query' : 'header', type: 'string' },
      ],
    };
  }

  return {
    type: 'noauth',
  };
}

function getRequestPath(url: string): string {
  if (!url) {
    return '/';
  }

  try {
    const parsed = new URL(url);
    return parsed.pathname || '/';
  } catch {
    const path = url.split('?')[0];
    if (!path) {
      return '/';
    }

    if (path.startsWith('/')) {
      return path;
    }

    const noHost = path.replace(/^https?:\/\/[^/]+/i, '');
    return noHost.startsWith('/') ? noHost : `/${noHost}`;
  }
}

function parseQueryParamsFromUrl(url: string): KeyValuePair[] {
  try {
    const parsed = new URL(url);
    const params: KeyValuePair[] = [];
    parsed.searchParams.forEach((value, key) => {
      params.push({ id: `${key}-${params.length + 1}`, key, value, enabled: true });
    });
    return params;
  } catch {
    return [];
  }
}

function mergeQueryParams(request: ApiRequest): KeyValuePair[] {
  const fromUrl = parseQueryParamsFromUrl(request.url);
  const all = [...fromUrl, ...(request.params || [])];
  const seen = new Set<string>();

  return all.filter((entry) => {
    const key = `${entry.key}:${entry.value}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function openApiRequestBody(request: ApiRequest): Record<string, unknown> | undefined {
  if (request.body.type === 'none' || !request.body.content) {
    return undefined;
  }

  if (request.body.type === 'json') {
    let example: unknown = request.body.content;
    try {
      example = JSON.parse(request.body.content);
    } catch {
      // Keep raw content as text example.
    }
    return {
      required: true,
      content: {
        'application/json': {
          example,
        },
      },
    };
  }

  if (request.body.type === 'xml') {
    return {
      required: true,
      content: {
        'application/xml': {
          example: request.body.content,
        },
      },
    };
  }

  if (request.body.type === 'form-urlencoded') {
    return {
      required: true,
      content: {
        'application/x-www-form-urlencoded': {
          example: request.body.content,
        },
      },
    };
  }

  if (request.body.type === 'form-data') {
    return {
      required: true,
      content: {
        'multipart/form-data': {
          example: request.body.content,
        },
      },
    };
  }

  return {
    required: true,
    content: {
      'text/plain': {
        example: request.body.content,
      },
    },
  };
}

function inferServers(collection: Collection): Array<{ url: string }> {
  const origins = new Set<string>();

  for (const request of collection.requests) {
    try {
      origins.add(new URL(request.url).origin);
    } catch {
      // Skip relative URLs.
    }
  }

  return Array.from(origins)
    .filter((origin) => Boolean(origin))
    .map((origin) => ({ url: origin }));
}

function collectionToOpenApi(collection: Collection): UnknownRecord {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const request of collection.requests) {
    const path = getRequestPath(request.url);
    const method = sanitizeMethod(request.method).toLowerCase();

    if (!paths[path]) {
      paths[path] = {};
    }

    const queryParameters = mergeQueryParams(request).map((param) => ({
      in: 'query',
      name: param.key,
      required: false,
      schema: { type: 'string' },
      description: param.description,
    }));

    const headerParameters = (request.headers || [])
      .filter((header) => header.enabled !== false && header.key.trim().length > 0)
      .map((header) => ({
        in: 'header',
        name: header.key,
        required: false,
        schema: { type: 'string' },
        description: header.description,
      }));

    const parameters = [...queryParameters, ...headerParameters];
    const requestBody = openApiRequestBody(request);

    paths[path][method] = {
      summary: request.name,
      description: request.description || '',
      operationId: `${method}_${toSlug(request.name || path)}`,
      parameters,
      requestBody,
      responses: {
        '200': {
          description: 'Successful response',
        },
      },
    };
  }

  return {
    openapi: '3.0.3',
    info: {
      title: collection.name,
      description: collection.description || '',
      version: '1.0.0',
    },
    servers: inferServers(collection),
    paths,
  };
}

export function serializeCollectionExport(
  collection: Collection,
  format: ExportTargetFormat,
): { filename: string; content: string; mimeType: string } {
  if (format === 'apik') {
    return {
      filename: `${toSlug(collection.name)}.apik.json`,
      content: JSON.stringify(collection, null, 2),
      mimeType: 'application/json',
    };
  }

  if (format === 'postman') {
    const payload = {
      info: {
        name: collection.name,
        description: collection.description || '',
        schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      },
      item: collection.requests.map((request) => ({
        name: request.name,
        request: {
          method: sanitizeMethod(request.method),
          header: toPostmanHeaders(request.headers || []),
          body: toPostmanBody(request),
          url: toPostmanUrl(request.url),
          description: request.description || '',
          auth: toPostmanAuth(request.auth),
        },
      })),
      variable: (collection.variables || []).map((variable) => ({
        key: variable.key,
        value: variable.value,
        type: 'string',
      })),
    };

    return {
      filename: `${toSlug(collection.name)}.postman_collection.json`,
      content: JSON.stringify(payload, null, 2),
      mimeType: 'application/json',
    };
  }

  const openApi = collectionToOpenApi(collection);
  return {
    filename: `${toSlug(collection.name)}.openapi.json`,
    content: JSON.stringify(openApi, null, 2),
    mimeType: 'application/json',
  };
}
