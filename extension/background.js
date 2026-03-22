// APIK Extension - Background Service Worker
// Manages WebSocket connection to APIK backend and request interception

let ws = null;
let wsUrl = 'wss://apik.app/ws/intercept';
let apiBaseUrl = 'https://apik.app';
let appBaseUrl = 'https://apik.app';
let interceptEnabled = false;
let pendingRequests = new Map(); // id -> { resolve, reject, request }
let reconnectTimer = null;
let connectionStatus = 'disconnected';
let connectionDetail = '';
const devtoolsPorts = new Set();
const webRequestIdMap = new Map(); // browser requestId -> apix requestId
const recentIntercepts = [];
let cachedInterceptCollectionId = null;
let apiAuthToken = null;
const DEVTOOLS_LOCAL_COLLECTIONS_KEY = 'apik.devtools.localCollections';
const BROWSER_SCOPE_STORAGE_KEY = 'apik.browserScopeId';
let browserScopeId = null;
let interceptSessionTicket = null;
let interceptSessionUserId = null;

function clearInterceptSession() {
  interceptSessionTicket = null;
  interceptSessionUserId = null;
}

function rememberIntercept(request) {
  recentIntercepts.push({
    id: request.id,
    method: String(request.method || 'GET').toUpperCase(),
    url: request.url || '',
    tabId: typeof request.tabId === 'number' ? request.tabId : -1,
    timestamp: typeof request.timestamp === 'number' ? request.timestamp : Date.now(),
  });

  if (recentIntercepts.length > 300) {
    recentIntercepts.splice(0, recentIntercepts.length - 300);
  }
}

function findMatchingInterceptId(details) {
  const direct = webRequestIdMap.get(details.requestId);
  if (direct) return direct;

  const method = String(details.method || 'GET').toUpperCase();
  const url = details.url || '';
  const tabId = typeof details.tabId === 'number' ? details.tabId : -1;
  const timeStamp = typeof details.timeStamp === 'number' ? details.timeStamp : Date.now();

  for (let index = recentIntercepts.length - 1; index >= 0; index -= 1) {
    const candidate = recentIntercepts[index];
    if (candidate.method !== method) continue;
    if (candidate.url !== url) continue;
    if (candidate.tabId !== tabId) continue;
    if (Math.abs(timeStamp - candidate.timestamp) > 15000) continue;

    webRequestIdMap.set(details.requestId, candidate.id);
    return candidate.id;
  }

  return null;
}

function trimTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function toApiBaseUrl(value) {
  const normalized = trimTrailingSlash(value);
  if (!normalized) return 'https://apik.app';
  return normalized;
}

function toWsUrlFromApiBase(baseUrl) {
  const normalized = toApiBaseUrl(baseUrl)
    .replace(/^http:/i, 'ws:')
    .replace(/^https:/i, 'wss:');
  return `${normalized}/ws/intercept`;
}

function normalizeWsUrl(value, fallbackApiBaseUrl = apiBaseUrl) {
  const raw = String(value || '').trim();
  if (!raw) {
    return toWsUrlFromApiBase(fallbackApiBaseUrl);
  }

  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
      parsed.protocol = parsed.protocol === 'http:' ? 'ws:' : 'wss:';
    }
    const path = parsed.pathname || '/';
    if (path === '/' || !path.startsWith('/ws/intercept')) {
      parsed.pathname = '/ws/intercept';
    }
    return parsed.toString();
  } catch {
    return toWsUrlFromApiBase(fallbackApiBaseUrl);
  }
}

function buildExtensionWsUrl() {
  try {
    const parsed = new URL(wsUrl);
    parsed.searchParams.set('type', 'extension');
    if (browserScopeId) {
      parsed.searchParams.set('scopeId', browserScopeId);
    }
    if (interceptSessionTicket) {
      parsed.searchParams.set('ticket', interceptSessionTicket);
    }
    return parsed.toString();
  } catch {
    const scopePart = browserScopeId ? `&scopeId=${encodeURIComponent(browserScopeId)}` : '';
    const ticketPart = interceptSessionTicket ? `&ticket=${encodeURIComponent(interceptSessionTicket)}` : '';
    return `${wsUrl}?type=extension${scopePart}${ticketPart}`;
  }
}

function toApiBaseFromWsUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return apiBaseUrl;
  try {
    const parsed = new URL(raw);
    const protocol = parsed.protocol === 'wss:' ? 'https:' : 'http:';
    return `${protocol}//${parsed.host}`;
  } catch {
    return apiBaseUrl;
  }
}

function getOrigin(value) {
  try {
    return new URL(String(value || '')).origin;
  } catch {
    return '';
  }
}

function buildApiUrl(path) {
  const base = toApiBaseUrl(apiBaseUrl);
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${base}${suffix}`;
}

function storageGet(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, (result) => resolve(result || {}));
  });
}

function storageSet(payload) {
  return new Promise((resolve) => {
    chrome.storage.local.set(payload, () => resolve());
  });
}

function hasApiAuthToken() {
  return typeof apiAuthToken === 'string' && apiAuthToken.length > 0;
}

function isLocalhostHost(hostname) {
  const normalized = String(hostname || '').toLowerCase();
  return (
    normalized === 'localhost' ||
    normalized === '127.0.0.1' ||
    normalized === '::1' ||
    normalized.endsWith('.localhost')
  );
}

function isTextContent(contentType) {
  const value = String(contentType || '').toLowerCase();
  return (
    value.includes('text') ||
    value.includes('json') ||
    value.includes('xml') ||
    value.includes('javascript') ||
    value.includes('html')
  );
}

function bytesToBase64(buffer) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < buffer.length; i += chunk) {
    const sub = buffer.subarray(i, i + chunk);
    binary += String.fromCharCode(...sub);
  }
  return btoa(binary);
}

function parseTargetUrl(url) {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

async function executeLocalProxyRequest(request) {
  const parsed = parseTargetUrl(request?.url);
  if (!parsed || !['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Invalid URL for local proxy request');
  }

  if (!isLocalhostHost(parsed.hostname)) {
    throw new Error('Extension proxy only supports localhost targets');
  }

  const startedAt = Date.now();
  const method = String(request.method || 'GET').toUpperCase();
  const timeoutMs = Number(request.timeout || 30000);
  const headers = new Headers(request.headers || {});
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(parsed.toString(), {
      method,
      headers,
      body: ['GET', 'HEAD', 'OPTIONS'].includes(method) ? undefined : (request.body ?? undefined),
      signal: controller.signal,
      redirect: 'follow',
    });

    const responseHeaders = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    const contentType = response.headers.get('content-type') || '';
    const buffer = new Uint8Array(await response.arrayBuffer());
    const body = isTextContent(contentType)
      ? new TextDecoder('utf-8').decode(buffer)
      : bytesToBase64(buffer);

    return {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      body,
      size: buffer.byteLength,
      time: Date.now() - startedAt,
    };
  } catch (error) {
    if (error && error.name === 'AbortError') {
      throw new Error(`Local request timeout after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function apiFetch(path, init = {}) {
  const headers = new Headers(init.headers || {});
  if (apiAuthToken) {
    headers.set('Authorization', `Bearer ${apiAuthToken}`);
  }

  const response = await fetch(buildApiUrl(path), {
    ...init,
    headers,
  });

  if (response.status === 401 && apiAuthToken) {
    apiAuthToken = null;
    cachedInterceptCollectionId = null;
    await storageSet({ apiAuthToken: null });
  }

  return response;
}

async function refreshInterceptSession() {
  if (!hasApiAuthToken()) {
    clearInterceptSession();
    return false;
  }

  try {
    const response = await apiFetch('/api/intercept/session', { method: 'GET' });
    if (!response.ok) {
      clearInterceptSession();
      return false;
    }

    const payload = await response.json();
    const ticket = typeof payload?.ticket === 'string' ? payload.ticket : '';
    const userId = typeof payload?.userId === 'string' ? payload.userId : '';
    if (!ticket || !userId) {
      clearInterceptSession();
      return false;
    }

    interceptSessionTicket = ticket;
    interceptSessionUserId = userId;
    return true;
  } catch {
    clearInterceptSession();
    return false;
  }
}

function isInternalUrl(url) {
  if (!url) return false;
  if (String(url).startsWith('chrome-extension://')) return true;
  try {
    const target = new URL(url);
    const backend = new URL(toApiBaseUrl(apiBaseUrl));
    return target.origin === backend.origin;
  } catch {
    return false;
  }
}

function shouldSkipWebRequest(details) {
  if (!interceptEnabled) return true;
  if (isInternalUrl(details.url)) {
    return true;
  }

  // fetch/XMLHttpRequest are already captured by injected.js with lower overhead
  // and richer request/response data. Skipping them here avoids duplicate work
  // and removes the extra latency users feel when intercept is enabled.
  return details.type === 'xmlhttprequest' || details.type === 'fetch';
}

function shouldSkipWebRequestHeaderTracking(details) {
  if (!interceptEnabled) return true;
  return isInternalUrl(details.url);
}

// ─── WebSocket Management ─────────────────────────────────────────────────────

async function connectWebSocket() {
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) return;

  if (!hasApiAuthToken()) {
    connectionStatus = 'auth_required';
    connectionDetail = 'Missing API auth token';
    broadcastStatus();
    return;
  }

  const hasSession = await refreshInterceptSession();
  if (!hasSession) {
    connectionStatus = 'auth_required';
    connectionDetail = 'Failed to obtain intercept session';
    broadcastStatus();
    return;
  }

  try {
    ws = new WebSocket(buildExtensionWsUrl());
    connectionStatus = 'connecting';
    connectionDetail = '';
    broadcastStatus();

    ws.onopen = () => {
      console.log('[APIK] Connected to backend');
      connectionStatus = 'connected';
      connectionDetail = '';
      broadcastStatus();
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    };

    ws.onclose = (event) => {
      console.log('[APIK] Disconnected from backend');
      if (event && event.code === 4401) {
        connectionStatus = 'auth_required';
        connectionDetail = 'WebSocket auth rejected (4401)';
      } else {
        connectionDetail = `WebSocket closed (${event?.code || 0})`;
      }
      const authBlocked = connectionStatus === 'auth_required';
      connectionStatus = authBlocked ? 'auth_required' : 'disconnected';
      ws = null;
      broadcastStatus();
      if (!authBlocked) {
        scheduleReconnect();
      }
    };

    ws.onerror = (err) => {
      console.warn('[APIK] WebSocket error', err);
      connectionStatus = 'error';
      connectionDetail = 'WebSocket transport error';
      broadcastStatus();
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleServerMessage(msg);
      } catch (e) {
        console.error('[APIK] Invalid WS message', e);
      }
    };
  } catch (err) {
    console.error('[APIK] Failed to create WebSocket:', err);
    connectionDetail = err instanceof Error ? err.message : 'Failed to create WebSocket';
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  if (connectionStatus === 'auth_required') return;
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void connectWebSocket();
  }, 3000);
}

function sendToServer(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
    return true;
  }
  return false;
}

function broadcastStatus() {
  chrome.runtime.sendMessage({
    type: 'STATUS_UPDATE',
    connected: connectionStatus === 'connected',
    interceptEnabled,
    status: connectionStatus,
      detail: connectionDetail,
      apiBaseUrl,
      appBaseUrl,
      scopeId: browserScopeId,
      userId: interceptSessionUserId,
  }).catch(() => {});

  broadcastDevtools({
    type: 'DEVTOOLS_STATUS',
    connected: connectionStatus === 'connected',
    interceptEnabled,
    status: connectionStatus,
      detail: connectionDetail,
      apiBaseUrl,
      appBaseUrl,
      scopeId: browserScopeId,
      userId: interceptSessionUserId,
  });
}

function broadcastDevtools(message) {
  for (const port of devtoolsPorts) {
    try {
      port.postMessage(message);
    } catch {
      // Ignore stale port
    }
  }
}

function notifyAppDataChanged() {
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      if (!tab.id || !tab.url) continue;
      try {
        const tabOrigin = new URL(tab.url).origin;
        const appOrigin = new URL(appBaseUrl).origin;
        if (tabOrigin !== appOrigin) continue;
      } catch {
        continue;
      }

      chrome.tabs.sendMessage(tab.id, { type: 'REMOTE_DATA_CHANGED' }, () => {
        void chrome.runtime.lastError;
      });
    }
  });
}

async function getLocalDevtoolsCollections() {
  const result = await storageGet([DEVTOOLS_LOCAL_COLLECTIONS_KEY]);
  return Array.isArray(result[DEVTOOLS_LOCAL_COLLECTIONS_KEY])
    ? result[DEVTOOLS_LOCAL_COLLECTIONS_KEY]
    : [];
}

async function saveLocalDevtoolsCollections(collections) {
  await storageSet({ [DEVTOOLS_LOCAL_COLLECTIONS_KEY]: collections });
}

async function getOrCreateLocalInterceptCollectionId() {
  if (cachedInterceptCollectionId) return cachedInterceptCollectionId;

  const collections = await getLocalDevtoolsCollections();
  const existing = collections.find((c) => c && c.name === 'Intercepted Requests');
  if (existing) {
    cachedInterceptCollectionId = existing.id;
    return existing.id;
  }

  const now = new Date().toISOString();
  const created = {
    id: crypto.randomUUID(),
    name: 'Intercepted Requests',
    requests: [],
    createdAt: now,
    updatedAt: now,
  };
  await saveLocalDevtoolsCollections([created, ...collections]);
  cachedInterceptCollectionId = created.id;
  return created.id;
}

async function getOrCreateInterceptCollectionId() {
  if (hasApiAuthToken()) {
    if (cachedInterceptCollectionId) return cachedInterceptCollectionId;

    const listResp = await apiFetch('/api/collections');
    if (!listResp.ok) throw new Error(`Failed to fetch collections (${listResp.status})`);
    const collections = await listResp.json();

    const existing = collections.find((c) => c.name === 'Intercepted Requests');
    if (existing) {
      cachedInterceptCollectionId = existing.id;
      return existing.id;
    }

    const createResp = await apiFetch('/api/collections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Intercepted Requests',
        description: 'Captured from APIK DevTools panel',
      }),
    });

    if (!createResp.ok) throw new Error(`Failed to create collection (${createResp.status})`);
    const created = await createResp.json();
    cachedInterceptCollectionId = created.id;
    return created.id;
  }

  return getOrCreateLocalInterceptCollectionId();
}

async function listCollections() {
  if (hasApiAuthToken()) {
    const response = await apiFetch('/api/collections');
    if (!response.ok) {
      throw new Error(`Failed to fetch collections (${response.status})`);
    }
    return response.json();
  }

  const collections = await getLocalDevtoolsCollections();
  return collections.map((c) => ({ id: c.id, name: c.name }));
}

async function createCollection(name) {
  if (hasApiAuthToken()) {
    const response = await apiFetch('/api/collections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name || 'New Collection' }),
    });

    if (!response.ok) {
      throw new Error(`Failed to create collection (${response.status})`);
    }

    return response.json();
  }

  const collections = await getLocalDevtoolsCollections();
  const now = new Date().toISOString();
  const created = {
    id: crypto.randomUUID(),
    name: (name || 'New Collection').trim() || 'New Collection',
    requests: [],
    createdAt: now,
    updatedAt: now,
  };
  await saveLocalDevtoolsCollections([created, ...collections]);
  return { id: created.id, name: created.name };
}

function toKeyValueArray(headers = {}) {
  return Object.entries(headers).map(([key, value]) => ({
    id: crypto.randomUUID(),
    key,
    value: String(value),
    enabled: true,
  }));
}

function parseUrlParams(url) {
  const out = [];
  try {
    const parsed = new URL(url);
    parsed.searchParams.forEach((value, key) => {
      out.push({ id: crypto.randomUUID(), key, value, enabled: true });
    });
  } catch {
    // ignore invalid urls
  }
  return out;
}

function detectRequestBody(body, headers = {}) {
  if (body == null || body === '') {
    return { type: 'none', content: '' };
  }

  const contentType = String(headers['content-type'] || headers['Content-Type'] || '').toLowerCase();
  const content = String(body);

  if (contentType.includes('application/json')) return { type: 'json', content };
  if (contentType.includes('xml') || content.trim().startsWith('<')) return { type: 'xml', content };
  if (contentType.includes('x-www-form-urlencoded')) return { type: 'form-urlencoded', content };
  if (contentType.includes('graphql')) return { type: 'graphql', content };

  try {
    JSON.parse(content);
    return { type: 'json', content };
  } catch {
    return { type: 'text', content };
  }
}

async function addCapturedRequestToCollection(request, collectionId, newCollectionName, requestName) {
  if (!hasApiAuthToken()) {
    let targetCollectionId = collectionId;
    let collections = await getLocalDevtoolsCollections();

    if (!targetCollectionId && newCollectionName) {
      const now = new Date().toISOString();
      const created = {
        id: crypto.randomUUID(),
        name: newCollectionName.trim() || 'New Collection',
        requests: [],
        createdAt: now,
        updatedAt: now,
      };
      collections = [created, ...collections];
      targetCollectionId = created.id;
    }

    if (!targetCollectionId) {
      targetCollectionId = await getOrCreateLocalInterceptCollectionId();
      collections = await getLocalDevtoolsCollections();
    }

    const targetIndex = collections.findIndex((entry) => entry.id === targetCollectionId);
    if (targetIndex === -1) {
      throw new Error('Target local collection not found');
    }

    const now = new Date().toISOString();
    const nextRequest = {
      id: crypto.randomUUID(),
      name: (requestName || `${request.method || 'GET'} ${request.url || ''}`).slice(0, 120),
      method: request.method || 'GET',
      url: request.url || '',
      headers: request.headers || {},
      body: request.body || '',
      source: request.source || 'devtools',
      createdAt: now,
      updatedAt: now,
    };

    const targetCollection = collections[targetIndex];
    collections[targetIndex] = {
      ...targetCollection,
      requests: [...(targetCollection.requests || []), nextRequest],
      updatedAt: now,
    };

    await saveLocalDevtoolsCollections(collections);
    return nextRequest;
  }

  let targetCollectionId = collectionId;

  if (!targetCollectionId && newCollectionName) {
    const created = await createCollection(newCollectionName);
    targetCollectionId = created.id;
  }

  if (!targetCollectionId) {
    targetCollectionId = await getOrCreateInterceptCollectionId();
  }

  const headers = request.headers || {};

  const payload = {
    name: (requestName || `${request.method || 'GET'} ${request.url || ''}`).slice(0, 120),
    method: request.method || 'GET',
    url: request.url || '',
    params: parseUrlParams(request.url || ''),
    headers: toKeyValueArray(headers),
    body: detectRequestBody(request.body, headers),
    auth: { type: 'none' },
    description: `Captured via APIK DevTools (${request.source || 'unknown'})`,
  };

  const resp = await apiFetch(`/api/collections/${targetCollectionId}/requests`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    throw new Error(`Failed to add request (${resp.status})`);
  }

  return resp.json();
}

// ─── Server Message Handler ───────────────────────────────────────────────────

function handleServerMessage(msg) {
  switch (msg.type) {
    case 'ERROR':
      if (msg.code === 'AUTH_REQUIRED') {
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
        clearInterceptSession();
        interceptEnabled = false;
        connectionStatus = 'auth_required';
        connectionDetail = 'Backend requires re-login';
        chrome.storage.local.set({ interceptEnabled: false });
        chrome.action.setBadgeText({ text: '' });
        broadcastStatus();
        if (ws) {
          ws.close();
        }
      }
      break;

    case 'STATE':
      interceptEnabled = msg.interceptEnabled;
      broadcastStatus();
      break;

    case 'INTERCEPT_STATE':
      interceptEnabled = msg.enabled;
      broadcastStatus();
      // Update extension badge
      chrome.action.setBadgeText({ text: interceptEnabled ? 'ON' : '' });
      chrome.action.setBadgeBackgroundColor({ color: '#f97316' });
      break;

    case 'FORWARD_REQUEST': {
      const pending = pendingRequests.get(msg.id);
      if (pending) {
        pendingRequests.delete(msg.id);
        pending.resolve({ action: 'forward', modified: msg.request });
        broadcastDevtools({ type: 'DEVTOOLS_REQUEST_UPDATE', id: msg.id, status: 'forwarded' });
      }
      break;
    }

    case 'DROP_REQUEST': {
      const pending = pendingRequests.get(msg.id);
      if (pending) {
        pendingRequests.delete(msg.id);
        pending.resolve({ action: 'drop' });
        broadcastDevtools({ type: 'DEVTOOLS_REQUEST_UPDATE', id: msg.id, status: 'dropped' });
      }
      break;
    }
  }
}

// ─── Request Interception via webRequest API ──────────────────────────────────

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (shouldSkipWebRequest(details)) return {};
    if (details.method === 'OPTIONS') return {};
    // Don't intercept internal extension or backend requests
    if (isInternalUrl(details.url)) {
      return {};
    }

    const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    webRequestIdMap.set(details.requestId, requestId);

    // Extract body if available
    let body = null;
    if (details.requestBody) {
      if (details.requestBody.raw) {
        try {
          const bytes = details.requestBody.raw[0]?.bytes;
          if (bytes) {
            const view = new Uint8Array(bytes);
            const decoded = new TextDecoder('utf-8', { fatal: false }).decode(view);
            const hasReplacement = decoded.includes('\uFFFD');
            if (!hasReplacement) {
              body = decoded;
            } else {
              let binary = '';
              const chunkSize = 0x8000;
              for (let i = 0; i < view.length; i += chunkSize) {
                const chunk = view.subarray(i, i + chunkSize);
                binary += String.fromCharCode(...chunk);
              }
              const base64 = btoa(binary);
              body = `[binary-body;base64] ${base64.slice(0, 1200)}${base64.length > 1200 ? '...' : ''}`;
            }
          }
        } catch {
          body = '[unreadable request body]';
        }
      } else if (details.requestBody.formData) {
        body = JSON.stringify(details.requestBody.formData, null, 2);
      }
    }

    // Get tab URL
    let tabUrl = '';
    if (details.tabId >= 0) {
      chrome.tabs.get(details.tabId, (tab) => {
        if (tab) tabUrl = tab.url || '';
      });
    }

    const intercepted = {
      id: requestId,
      tabId: details.tabId,
      tabUrl,
      method: details.method,
      url: details.url,
      headers: {},
      body,
      timestamp: Date.now(),
    };

    rememberIntercept(intercepted);

    sendToServer({
      type: 'INTERCEPTED_REQUEST',
      ...intercepted,
      source: 'webRequest',
    });

    broadcastDevtools({
      type: 'DEVTOOLS_INTERCEPTED',
      request: {
        ...intercepted,
        source: 'webRequest',
        status: 'pending',
      },
    });

    // Block request until server decides (with 30s timeout)
    // Note: In MV3, we can't truly block with webRequest (need declarativeNetRequest)
    // The intercept here is best-effort – for true blocking, use the injected script approach
    return {};
  },
  { urls: ['<all_urls>'] },
  ['requestBody']
);

chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (shouldSkipWebRequestHeaderTracking(details)) return;

    const apixRequestId = findMatchingInterceptId(details);
    if (!apixRequestId) return;

    const responseHeaders = {};
    (details.responseHeaders || []).forEach((h) => {
      responseHeaders[h.name] = h.value || '';
    });

    broadcastDevtools({
      type: 'DEVTOOLS_RESPONSE_UPDATE',
      id: apixRequestId,
      response: {
        status: details.statusCode,
        statusText: details.statusLine || '',
        headers: responseHeaders,
        body: '',
        source: 'webRequest',
      },
    });
  },
  { urls: ['<all_urls>'] },
  ['responseHeaders']
);

chrome.webRequest.onCompleted.addListener(
  (details) => {
    if (shouldSkipWebRequestHeaderTracking(details)) return;
    const apixRequestId = findMatchingInterceptId(details);
    if (!apixRequestId) return;

    broadcastDevtools({
      type: 'DEVTOOLS_REQUEST_UPDATE',
      id: apixRequestId,
      status: 'completed',
    });

    webRequestIdMap.delete(details.requestId);
  },
  { urls: ['<all_urls>'] }
);

chrome.webRequest.onErrorOccurred.addListener(
  (details) => {
    if (shouldSkipWebRequestHeaderTracking(details)) return;
    const apixRequestId = findMatchingInterceptId(details);
    if (!apixRequestId) return;

    broadcastDevtools({
      type: 'DEVTOOLS_REQUEST_UPDATE',
      id: apixRequestId,
      status: `error: ${details.error || 'unknown'}`,
    });

    webRequestIdMap.delete(details.requestId);
  },
  { urls: ['<all_urls>'] }
);

// Listen for request headers to capture them
chrome.webRequest.onSendHeaders.addListener(
  (details) => {
    if (shouldSkipWebRequestHeaderTracking(details)) return;

    const headers = {};
    (details.requestHeaders || []).forEach((h) => {
      headers[h.name] = h.value || '';
    });

    const apixRequestId = findMatchingInterceptId(details);
    if (apixRequestId) {
      broadcastDevtools({
        type: 'DEVTOOLS_REQUEST_HEADERS_UPDATE',
        id: apixRequestId,
        headers,
      });
    }

    // Send headers update
    sendToServer({
      type: 'REQUEST_HEADERS',
      id: apixRequestId,
      url: details.url,
      method: details.method,
      headers,
      tabId: details.tabId,
    });
  },
  { urls: ['<all_urls>'] },
  ['requestHeaders']
);

// ─── Message Handler from Popup / Content Scripts ────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {
    case 'GET_STATUS':
      sendResponse({
        connected: connectionStatus === 'connected',
        interceptEnabled,
        wsUrl,
        status: connectionStatus,
        detail: connectionDetail,
        apiBaseUrl,
        appBaseUrl,
        scopeId: browserScopeId,
        userId: interceptSessionUserId,
      });
      return true;

    case 'SET_WS_URL':
      wsUrl = normalizeWsUrl(msg.url, apiBaseUrl);
      apiBaseUrl = toApiBaseFromWsUrl(wsUrl);
      chrome.storage.local.set({ wsUrl, apiBaseUrl });
      if (ws) { ws.close(); ws = null; }
      void connectWebSocket();
      sendResponse({ ok: true });
      return true;

    case 'SET_BASE_URLS': {
      const nextApiBaseUrl = toApiBaseUrl(msg.apiBaseUrl || apiBaseUrl);
      const nextAppBaseUrl = trimTrailingSlash(msg.appBaseUrl || appBaseUrl) || appBaseUrl;
      apiBaseUrl = nextApiBaseUrl;
      appBaseUrl = nextAppBaseUrl;
      wsUrl = normalizeWsUrl(msg.wsUrl, apiBaseUrl);
      chrome.storage.local.set({ apiBaseUrl, appBaseUrl, wsUrl });
      if (ws) { ws.close(); ws = null; }
      void connectWebSocket();
      sendResponse({ ok: true, apiBaseUrl, appBaseUrl, wsUrl });
      return true;
    }

    case 'SET_INTERCEPT':
      if (!hasApiAuthToken()) {
        interceptEnabled = false;
        chrome.storage.local.set({ interceptEnabled: false });
        chrome.action.setBadgeText({ text: '' });
        broadcastStatus();
        sendResponse({ ok: false, error: 'AUTH_REQUIRED' });
        return true;
      }
      interceptEnabled = msg.enabled;
      chrome.storage.local.set({ interceptEnabled: msg.enabled });
      sendToServer({ type: 'SET_INTERCEPT', enabled: msg.enabled });
      chrome.action.setBadgeText({ text: msg.enabled ? 'ON' : '' });
      broadcastStatus();
      sendResponse({ ok: true });
      return true;

    case 'SET_AUTH_TOKEN':
      {
        const tokenOrigin = getOrigin(msg.origin);
        const appOrigin = getOrigin(appBaseUrl);
        const apiOrigin = getOrigin(apiBaseUrl);
        const wsApiOrigin = getOrigin(toApiBaseFromWsUrl(wsUrl));

        if (tokenOrigin) {
          appBaseUrl = tokenOrigin;

          const apiLooksDefault = apiOrigin === 'https://apik.app' || wsApiOrigin === 'https://apik.app';
          const apiWasFollowingApp = appOrigin && apiOrigin === appOrigin;
          if (!apiOrigin || apiLooksDefault || apiWasFollowingApp) {
            apiBaseUrl = tokenOrigin;
          }
          wsUrl = normalizeWsUrl(wsUrl, apiBaseUrl);
        }
      }

      apiAuthToken = typeof msg.token === 'string' && msg.token ? msg.token : null;
      cachedInterceptCollectionId = null;
      clearInterceptSession();
      if (!apiAuthToken) {
        interceptEnabled = false;
        chrome.storage.local.set({ interceptEnabled: false });
        chrome.action.setBadgeText({ text: '' });
        if (ws) { ws.close(); ws = null; }
      } else {
        void connectWebSocket();
      }
      storageSet({ apiAuthToken, apiBaseUrl, appBaseUrl, wsUrl });
      broadcastStatus();
      sendResponse({ ok: true });
      return true;

    case 'PROXY_LOCAL_REQUEST':
      (async () => {
        try {
          const response = await executeLocalProxyRequest(msg.request || {});
          sendResponse({ ok: true, requestId: msg.requestId, response });
        } catch (error) {
          sendResponse({
            ok: false,
            requestId: msg.requestId,
            error: error instanceof Error ? error.message : 'Extension local proxy failed',
          });
        }
      })();
      return true;

    case 'OPEN_APIX':
      chrome.tabs.create({ url: msg.url || appBaseUrl });
      sendResponse({ ok: true });
      return true;

    case 'INTERCEPTED_FROM_PAGE':
      // From injected content script
      if (!interceptEnabled || !hasApiAuthToken() || !interceptSessionUserId) {
        sendResponse({ action: 'forward' });
        return true;
      }

      const tabId = sender.tab?.id;
      const tabUrl = sender.tab?.url;
      const enrichedRequest = {
        ...msg.request,
        tabId,
        tabUrl,
        timestamp: msg.request?.timestamp || Date.now(),
      };
      rememberIntercept(enrichedRequest);

      // Non-blocking mode: always forward page request immediately to avoid latency.
      // Intercept data is still mirrored to backend and DevTools for inspection.
      sendToServer({ type: 'INTERCEPTED_REQUEST', ...enrichedRequest, source: 'injected' });
      broadcastDevtools({
        type: 'DEVTOOLS_INTERCEPTED',
        request: {
          ...enrichedRequest,
          source: 'injected',
          status: 'forwarded',
        },
      });
      sendResponse({ action: 'forward' });
      return true;

    case 'INTERCEPTED_RESPONSE_FROM_PAGE':
      broadcastDevtools({
        type: 'DEVTOOLS_RESPONSE_UPDATE',
        id: msg.response?.id,
        response: msg.response,
      });
      sendResponse({ ok: true });
      return true;

    case 'FORWARD_REQUEST':
      sendToServer({ type: 'FORWARD_REQUEST', id: msg.id });
      broadcastDevtools({ type: 'DEVTOOLS_REQUEST_UPDATE', id: msg.id, status: 'forwarded' });
      sendResponse({ ok: true });
      return true;

    case 'DROP_REQUEST':
      sendToServer({ type: 'DROP_REQUEST', id: msg.id });
      broadcastDevtools({ type: 'DEVTOOLS_REQUEST_UPDATE', id: msg.id, status: 'dropped' });
      sendResponse({ ok: true });
      return true;
  }
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'apix-devtools') return;
  devtoolsPorts.add(port);

  port.onMessage.addListener((msg) => {
    if (msg?.type === 'DEVTOOLS_INIT') {
      port.postMessage({
        type: 'DEVTOOLS_STATUS',
        connected: connectionStatus === 'connected',
        interceptEnabled,
        status: connectionStatus,
      });
      return;
    }

    if (msg?.type === 'DEVTOOLS_ADD_TO_COLLECTION') {
      (async () => {
        try {
          await addCapturedRequestToCollection(msg.request || {}, msg.collectionId, msg.newCollectionName, msg.requestName);
          port.postMessage({ type: 'DEVTOOLS_ADD_RESULT', ok: true, id: msg.id });
          notifyAppDataChanged();
        } catch (error) {
          port.postMessage({
            type: 'DEVTOOLS_ADD_RESULT',
            ok: false,
            id: msg.id,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      })();
      return;
    }

    if (msg?.type === 'DEVTOOLS_LIST_COLLECTIONS') {
      (async () => {
        try {
          const collections = await listCollections();
          port.postMessage({
            type: 'DEVTOOLS_COLLECTIONS_RESULT',
            ok: true,
            requestId: msg.requestId,
            collections: collections.map((c) => ({ id: c.id, name: c.name })),
          });
        } catch (error) {
          port.postMessage({
            type: 'DEVTOOLS_COLLECTIONS_RESULT',
            ok: false,
            requestId: msg.requestId,
            collections: [],
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      })();
      return;
    }

    if (msg?.type === 'DEVTOOLS_CLEAR_INTERCEPTS') {
      sendToServer({ type: 'CLEAR_INTERCEPTS' });
      return;
    }
  });

  port.onDisconnect.addListener(() => {
    devtoolsPorts.delete(port);
  });
});

// ─── Init ─────────────────────────────────────────────────────────────────────

// Load saved settings
chrome.storage.local.get(['wsUrl', 'apiBaseUrl', 'appBaseUrl', 'interceptEnabled', 'apiAuthToken', BROWSER_SCOPE_STORAGE_KEY], async (result) => {
  if (result.apiBaseUrl) apiBaseUrl = toApiBaseUrl(result.apiBaseUrl);
  if (result.appBaseUrl) appBaseUrl = trimTrailingSlash(result.appBaseUrl) || appBaseUrl;
  wsUrl = normalizeWsUrl(result.wsUrl, apiBaseUrl);
  if (result.interceptEnabled) interceptEnabled = result.interceptEnabled;
  if (typeof result.apiAuthToken === 'string' && result.apiAuthToken) apiAuthToken = result.apiAuthToken;

  const storedScopeId = typeof result[BROWSER_SCOPE_STORAGE_KEY] === 'string'
    ? result[BROWSER_SCOPE_STORAGE_KEY]
    : '';
  browserScopeId = storedScopeId || crypto.randomUUID();
  if (!storedScopeId) {
    await storageSet({ [BROWSER_SCOPE_STORAGE_KEY]: browserScopeId });
  }

  void connectWebSocket();
});
