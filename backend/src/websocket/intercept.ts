import { WebSocketServer, WebSocket } from 'ws';
import { InterceptedRequest } from '../types';
import { v4 as uuidv4 } from 'uuid';

interface InterceptClient {
  ws: WebSocket;
  type: 'app' | 'extension';
  scope: string;
  userId: string;
}

interface InterceptScopeState {
  interceptEnabled: boolean;
  pendingRequests: Map<string, InterceptedRequest>;
}

const clients: Map<string, InterceptClient> = new Map();
const scopeStates: Map<string, InterceptScopeState> = new Map();
const mobileHistoryByUserId: Map<string, InterceptedRequest[]> = new Map();
const interceptSessionTickets = new Map<string, { userId: string; expiresAt: number }>();
const INTERCEPT_TICKET_TTL_MS = 2 * 60 * 1000;
const MAX_MOBILE_HISTORY = 500;

function pruneExpiredInterceptTickets(now = Date.now()): void {
  for (const [ticket, session] of interceptSessionTickets.entries()) {
    if (session.expiresAt <= now) {
      interceptSessionTickets.delete(ticket);
    }
  }
}

function consumeInterceptTicket(ticket: string): string | null {
  pruneExpiredInterceptTickets();
  const session = interceptSessionTickets.get(ticket);
  if (!session) {
    return null;
  }
  interceptSessionTickets.delete(ticket);
  return session.userId;
}

export function issueInterceptSession(userId: string): { ticket: string; expiresAt: number } {
  pruneExpiredInterceptTickets();
  const ticket = uuidv4();
  const expiresAt = Date.now() + INTERCEPT_TICKET_TTL_MS;
  interceptSessionTickets.set(ticket, { userId, expiresAt });
  return { ticket, expiresAt };
}

function detectBrowserScope(userAgent: string): string {
  const ua = userAgent.toLowerCase();
  if (ua.includes('firefox')) return 'firefox';
  if (ua.includes('edg/')) return 'edge';
  if (ua.includes('opr/') || ua.includes('opera')) return 'opera';
  if (ua.includes('chrome') || ua.includes('chromium')) return 'chrome';
  if (ua.includes('safari')) return 'safari';
  return 'unknown';
}

function getScopeState(scope: string): InterceptScopeState {
  let state = scopeStates.get(scope);
  if (!state) {
    state = {
      interceptEnabled: false,
      pendingRequests: new Map<string, InterceptedRequest>(),
    };
    scopeStates.set(scope, state);
  }
  return state;
}

function getMobileHistory(userId: string): InterceptedRequest[] {
  return mobileHistoryByUserId.get(userId) || [];
}

function upsertMobileHistory(userId: string, request: InterceptedRequest): void {
  const existing = getMobileHistory(userId);
  const next = [...existing];
  const index = next.findIndex((entry) => entry.id === request.id);
  if (index >= 0) {
    next[index] = {
      ...next[index],
      ...request,
    };
  } else {
    next.push(request);
  }

  next.sort((a, b) => b.timestamp - a.timestamp);
  mobileHistoryByUserId.set(userId, next.slice(0, MAX_MOBILE_HISTORY));
}

function updateMobileHistoryResponse(
  userId: string,
  id: string,
  statusCode: number | undefined,
  headers: Record<string, string>,
  body: string | undefined,
  responseTimestamp: number,
): void {
  const existing = getMobileHistory(userId);
  const next = [...existing];
  const index = next.findIndex((entry) => entry.id === id);
  if (index < 0) {
    return;
  }

  next[index] = {
    ...next[index],
    responseStatusCode: statusCode,
    responseHeaders: headers,
    responseBody: body,
    responseTimestamp,
  };
  mobileHistoryByUserId.set(userId, next);
}

export function setupWebSocket(wss: WebSocketServer): void {
  wss.on('connection', (ws: WebSocket, req) => {
    const clientId = uuidv4();
    const url = req.url || '';
    let explicitScopeId = '';
    let explicitClientType = '';
    let ticket = '';
    try {
      const parsed = new URL(url, 'ws://localhost');
      explicitScopeId = String(parsed.searchParams.get('scopeId') || '').trim();
      explicitClientType = String(parsed.searchParams.get('type') || '').trim();
      ticket = String(parsed.searchParams.get('ticket') || '').trim();
    } catch {
      explicitScopeId = '';
      explicitClientType = '';
      ticket = '';
    }
    const clientType: 'app' | 'extension' = explicitClientType === 'extension' || url.includes('extension')
      ? 'extension'
      : 'app';

    const userId = ticket ? consumeInterceptTicket(ticket) : null;
    if (!userId) {
      ws.send(JSON.stringify({ type: 'ERROR', code: 'AUTH_REQUIRED', message: 'Intercept login session required' }));
      ws.close(4401, 'Authentication required');
      return;
    }

    const userAgentHeader = req.headers['user-agent'];
    const userAgent = Array.isArray(userAgentHeader)
      ? userAgentHeader.join(' ')
      : String(userAgentHeader || '');
    const scopeBase = explicitScopeId
      ? `scope:${explicitScopeId}`
      : `browser:${detectBrowserScope(userAgent)}`;
    const scope = `user:${userId}:${scopeBase}`;
    const scopeState = getScopeState(scope);

    clients.set(clientId, { ws, type: clientType, scope, userId });
    console.log(`[WS] Client connected: ${clientId} (${clientType}, user=${userId}, scope=${scope})`);

    // Send current intercept state for this browser scope.
    const mobileHistory = getMobileHistory(userId);
    const pendingRequests = Array.from(scopeState.pendingRequests.values());
    const stateRequests = [...pendingRequests];
    for (const entry of mobileHistory) {
      if (!stateRequests.some((request) => request.id === entry.id)) {
        stateRequests.push(entry);
      }
    }
    stateRequests.sort((a, b) => b.timestamp - a.timestamp);

    ws.send(JSON.stringify({
      type: 'STATE',
      interceptEnabled: scopeState.interceptEnabled,
      pendingRequests: stateRequests,
    }));

    ws.on('message', (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());
        handleMessage(clientId, msg);
      } catch (err) {
        console.error('[WS] Invalid message:', err);
      }
    });

    ws.on('close', () => {
      clients.delete(clientId);
      console.log(`[WS] Client disconnected: ${clientId}`);
    });

    ws.on('error', (err) => {
      console.error(`[WS] Error on ${clientId}:`, err.message);
    });
  });
}

function handleMessage(clientId: string, msg: Record<string, unknown>) {
  const { type } = msg;
  const client = clients.get(clientId);
  if (!client) return;
  const scope = client.scope;
  const scopeState = getScopeState(scope);

  switch (type) {
    case 'PING':
      return;

    case 'SET_INTERCEPT':
      scopeState.interceptEnabled = Boolean(msg.enabled);
      broadcastToScope(scope, { type: 'INTERCEPT_STATE', enabled: scopeState.interceptEnabled });
      break;

    case 'INTERCEPTED_REQUEST':
      // From extension: a request was intercepted
      if (!scopeState.interceptEnabled) {
        // Forward immediately if intercept is off
        sendToExtensionInScope(scope, { type: 'FORWARD_REQUEST', id: msg.id, request: msg.request });
        return;
      }
      const intercepted: InterceptedRequest = {
        id: String(msg.id || uuidv4()),
        tabId: msg.tabId as number | undefined,
        tabUrl: msg.tabUrl as string | undefined,
        method: String(msg.method || 'GET'),
        url: String(msg.url || ''),
        headers: (msg.headers as Record<string, string>) || {},
        body: msg.body as string | undefined,
        timestamp: Date.now(),
        status: 'pending',
      };
      scopeState.pendingRequests.set(intercepted.id, intercepted);
      broadcastToAppClientsInScope(scope, { type: 'NEW_INTERCEPTED_REQUEST', request: intercepted });
      break;

    case 'REQUEST_HEADERS': {
      const id = typeof msg.id === 'string' ? msg.id : '';
      const headers = (msg.headers as Record<string, string>) || {};
      if (!id) {
        break;
      }

      const existing = scopeState.pendingRequests.get(id);
      if (!existing) {
        break;
      }

      existing.headers = {
        ...existing.headers,
        ...headers,
      };

      scopeState.pendingRequests.set(id, existing);
      broadcastToAppClientsInScope(scope, { type: 'INTERCEPT_HEADERS_UPDATED', id, headers: existing.headers });
      break;
    }

    case 'FORWARD_REQUEST': {
      // From app: user wants to forward an intercepted request
      const id = String(msg.id);
      const existing = scopeState.pendingRequests.get(id);
      if (existing) {
        existing.status = 'forwarded';
        scopeState.pendingRequests.delete(id);
        sendToExtensionInScope(scope, { type: 'FORWARD_REQUEST', id, request: msg.modifiedRequest || existing });
        broadcastToAppClientsInScope(scope, { type: 'REQUEST_FORWARDED', id });
      }
      break;
    }

    case 'DROP_REQUEST': {
      // From app: user wants to drop an intercepted request
      const id = String(msg.id);
      const existing = scopeState.pendingRequests.get(id);
      if (existing) {
        existing.status = 'dropped';
        scopeState.pendingRequests.delete(id);
        sendToExtensionInScope(scope, { type: 'DROP_REQUEST', id });
        broadcastToAppClientsInScope(scope, { type: 'REQUEST_DROPPED', id });
      }
      break;
    }

    case 'CLEAR_INTERCEPTS':
      scopeState.pendingRequests.clear();
      broadcastToAppClientsInScope(scope, { type: 'INTERCEPTS_CLEARED' });
      break;

    default:
      console.log(`[WS] Unknown message type: ${type}`);
  }
}

function broadcastToScope(scope: string, msg: unknown) {
  const data = JSON.stringify(msg);
  clients.forEach(({ ws, scope: clientScope }) => {
    if (clientScope === scope && ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  });
}

function broadcastToAppClientsInScope(scope: string, msg: unknown) {
  const data = JSON.stringify(msg);
  clients.forEach(({ ws, type, scope: clientScope }) => {
    if (clientScope === scope && type === 'app' && ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  });
}

function sendToExtensionInScope(scope: string, msg: unknown) {
  const data = JSON.stringify(msg);
  clients.forEach(({ ws, type, scope: clientScope }) => {
    if (clientScope === scope && type === 'extension' && ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  });
}

/**
 * Send a MitM proxy event (captured request or response) to all app-type
 * WebSocket clients that belong to the given userId, regardless of their scope.
 * Called by interceptProxy when a mobile-proxy request is captured.
 */
export function broadcastMobileTraffic(userId: string, msg: unknown): void {
  const asRecord = (typeof msg === 'object' && msg !== null) ? msg as Record<string, unknown> : null;
  if (asRecord?.type === 'NEW_INTERCEPTED_REQUEST') {
    const request = asRecord.request as InterceptedRequest | undefined;
    if (request && typeof request.id === 'string') {
      upsertMobileHistory(userId, request);
    }
  }

  if (asRecord?.type === 'MOBILE_PROXY_RESPONSE') {
    const id = typeof asRecord.id === 'string' ? asRecord.id : '';
    if (id) {
      updateMobileHistoryResponse(
        userId,
        id,
        typeof asRecord.statusCode === 'number' ? asRecord.statusCode : undefined,
        (asRecord.headers as Record<string, string>) || {},
        typeof asRecord.body === 'string' ? asRecord.body : undefined,
        typeof asRecord.timestamp === 'number' ? asRecord.timestamp : Date.now(),
      );
    }
  }

  const data = JSON.stringify(msg);
  clients.forEach(({ ws, type, userId: clientUserId }) => {
    if (clientUserId === userId && type === 'app' && ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  });
}
