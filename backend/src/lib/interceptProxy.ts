/**
 * interceptProxy — HTTP/HTTPS MitM proxy server.
 *
 * Key concepts:
 *  - Per-user: each user gets proxy credentials (proxyUser/proxyPassword).
 *    Mobile sets proxy with those credentials. Basic auth is validated server-side to map
 *    traffic to the correct user's WebSocket channel.
 *
 *  - Per-user isolation: captured traffic is broadcast only to that user's WS clients via
 *    broadcastMobileTraffic(userId, ...).
 *
 *  - HTTPS MitM: for CONNECT tunnels we present a per-hostname cert signed by the APIK CA.
 *    The phone must trust the downloaded CA cert for HTTPS inspection to work.
 *    Falls back to a blind TCP tunnel when the CA is not ready or cert generation fails.
 *
 *  - DNS/Cloudflare note: the proxy host MUST be the raw VPS IP (or a DNS-only/grey-cloud
 *    subdomain). Cloudflare-proxied (orange cloud) domains terminate TCP at CF's edge and
 *    will break the CONNECT handshake used for HTTPS tunnelling.
 */

import http from 'http';
import https from 'https';
import net from 'net';
import tls from 'tls';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { randomBytes } from 'crypto';
import { execSync } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import { CA_CERT_PATH, CA_KEY_PATH, isCaReady } from './caManager';
import { resolveWireGuardUserIdByClientIp } from './wireguardManager';
import { broadcastMobileTraffic } from '../websocket/intercept';

// ── Constants ────────────────────────────────────────────────────────────────

function parseProxyPorts(): number[] {
  const rawRange = String(process.env.INTERCEPT_PROXY_PORT_RANGE || '').trim();
  if (rawRange) {
    const matched = rawRange.match(/^(\d{2,5})\s*-\s*(\d{2,5})$/);
    if (matched) {
      const start = Number(matched[1]);
      const end = Number(matched[2]);
      if (Number.isInteger(start) && Number.isInteger(end) && start >= 1 && end <= 65535 && start <= end) {
        const ports: number[] = [];
        for (let port = start; port <= end; port += 1) {
          ports.push(port);
        }
        return ports;
      }
    }
  }

  const singlePort = Number(process.env.INTERCEPT_PROXY_PORT || '8080');
  if (Number.isInteger(singlePort) && singlePort > 0 && singlePort <= 65535) {
    return [singlePort];
  }
  return [8080];
}

const PROXY_PORTS = parseProxyPorts();
const blockedProxyPorts = new Set<number>();

function boolFromEnv(value: string | undefined, defaultValue: boolean): boolean {
  if (!value) return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return defaultValue;
}

function transparentWireGuardEnabled(): boolean {
  return boolFromEnv(process.env.INTERCEPT_WIREGUARD_TRANSPARENT_ENABLE, false);
}

function transparentWireGuardPort(): number {
  const parsed = Number(process.env.INTERCEPT_WIREGUARD_TRANSPARENT_PORT || '18080');
  if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535) {
    return parsed;
  }
  return 18080;
}

function httpsMitmEnabled(): boolean {
  return boolFromEnv(process.env.INTERCEPT_PROXY_HTTPS_MITM_ENABLE, false);
}

function effectiveProxyPorts(): number[] {
  return PROXY_PORTS.filter((port) => !blockedProxyPorts.has(port));
}

const CERT_CACHE_DIR = process.env.INTERCEPT_CA_DIR
  ? path.join(path.resolve(process.env.INTERCEPT_CA_DIR), 'hostcerts')
  : path.resolve(__dirname, '../../data/intercept-ca/hostcerts');
const PROXY_CREDENTIALS_FILE = path.resolve(__dirname, '../../data/proxy-credentials.json');

// Requests/responses > MAX_CAPTURE_BYTES are forwarded but not fully captured.
const MAX_CAPTURE_BYTES = 10 * 1024 * 1024; // 10 MB

interface ProxyRuntimeStats {
  startedAt: number;
  plainHttpRequests: number;
  connectTunnels: number;
  transparentConnections: number;
  authFailures: number;
  captureRequests: number;
  captureResponses: number;
  upstreamErrors: number;
  lastRequestAt: number | null;
  lastResponseAt: number | null;
  lastAuthFailureAt: number | null;
  lastConnectAt: number | null;
}

const runtimeStats: ProxyRuntimeStats = {
  startedAt: Date.now(),
  plainHttpRequests: 0,
  connectTunnels: 0,
  transparentConnections: 0,
  authFailures: 0,
  captureRequests: 0,
  captureResponses: 0,
  upstreamErrors: 0,
  lastRequestAt: null,
  lastResponseAt: null,
  lastAuthFailureAt: null,
  lastConnectAt: null,
};

export function getProxyPortPoolStats(): {
  mode: 'single' | 'range';
  range: string;
  totalPorts: number;
  assignedPorts: number;
  availablePorts: number;
} {
  const ports = effectiveProxyPorts();
  const totalPorts = ports.length;
  const assignedPorts = userIdByAssignedPort.size;
  const availablePorts = Math.max(totalPorts - assignedPorts, 0);
  const mode: 'single' | 'range' = totalPorts > 1 ? 'range' : 'single';
  const range = totalPorts > 1
    ? `${ports[0]}-${ports[ports.length - 1]}`
    : String(ports[0] || 8080);

  return {
    mode,
    range,
    totalPorts,
    assignedPorts,
    availablePorts,
  };
}

export function getInterceptProxyStats(): ProxyRuntimeStats & { uptimeMs: number } {
  return {
    ...runtimeStats,
    uptimeMs: Date.now() - runtimeStats.startedAt,
  };
}

function toByteArray(chunk: Buffer): Uint8Array {
  return new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
}

function concatChunks(chunks: Uint8Array[]): Buffer {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const merged = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return Buffer.from(merged);
}

function headerValueToString(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value.join(', ');
  return typeof value === 'string' ? value : '';
}

function getHeaderCaseInsensitive(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string {
  const direct = headerValueToString(headers[name]);
  if (direct) return direct;
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? headerValueToString(headers[key]) : '';
}

function maybeDecodeCompressedBody(body: Buffer, contentEncoding: string): Buffer {
  const encoding = contentEncoding.toLowerCase();
  const input = toByteArray(body);
  try {
    if (encoding.includes('gzip')) return zlib.gunzipSync(input) as Buffer;
    if (encoding.includes('deflate')) return zlib.inflateSync(input) as Buffer;
    if (encoding.includes('br')) return zlib.brotliDecompressSync(input) as Buffer;
  } catch {
    // Keep raw bytes if decompression fails.
  }
  return body;
}

function isLikelyTextBody(buf: Buffer): boolean {
  if (!buf.length) return false;
  const sampleSize = Math.min(buf.length, 2048);
  let suspicious = 0;
  for (let i = 0; i < sampleSize; i += 1) {
    const b = buf[i];
    if (b === 0) return false;
    const isControl = b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d;
    if (isControl) suspicious += 1;
  }
  return suspicious / sampleSize < 0.1;
}

function decodeBodyForCapture(
  headers: Record<string, string | string[] | undefined>,
  body: Buffer,
): string | undefined {
  if (!body.length) return undefined;

  const contentType = getHeaderCaseInsensitive(headers, 'content-type').toLowerCase();
  const contentEncoding = getHeaderCaseInsensitive(headers, 'content-encoding');
  const decoded = maybeDecodeCompressedBody(body, contentEncoding);

  const isTextByType =
    contentType.startsWith('text/') ||
    contentType.includes('json') ||
    contentType.includes('xml') ||
    contentType.includes('javascript') ||
    contentType.includes('x-www-form-urlencoded') ||
    contentType.includes('graphql') ||
    contentType.includes('svg');

  if (!isTextByType && !isLikelyTextBody(decoded)) {
    return `[binary ${decoded.length} bytes not shown]`;
  }

  const text = decoded.toString('utf8');
  if (text.includes('\u0000')) {
    return `[binary ${decoded.length} bytes not shown]`;
  }

  return text;
}

// ── Proxy token management ───────────────────────────────────────────────────

interface ProxyTokenEntry {
  userId: string;
  proxyUser: string;
  proxyPassword: string;
  assignedPort: number;
  assignedPortExpiresAt: number;
  expiresAt: number;
}

const proxyCredentialsByUserId = new Map<string, ProxyTokenEntry>();
const userIdByCredentialKey = new Map<string, string>();
const userIdByAssignedPort = new Map<number, string>();
const TOKEN_TTL_MS = 180 * 24 * 60 * 60 * 1000; // 180 days
const PORT_LEASE_MS = 180 * 24 * 60 * 60 * 1000; // Keep port stable for 180 days.
const TOKEN_REUSE_MIN_TTL_MS = 5 * 60 * 1000; // Reuse token if still valid for at least 5 minutes.

function credentialKey(proxyUser: string, proxyPassword: string): string {
  return `${proxyUser}\u0000${proxyPassword}`;
}

function persistProxyCredentialsToDisk(): void {
  try {
    fs.mkdirSync(path.dirname(PROXY_CREDENTIALS_FILE), { recursive: true });
    const payload = {
      version: 1,
      updatedAt: Date.now(),
      entries: Array.from(proxyCredentialsByUserId.values()),
    };
    fs.writeFileSync(PROXY_CREDENTIALS_FILE, JSON.stringify(payload, null, 2), 'utf8');
  } catch (error) {
    console.warn('[interceptProxy] failed to persist proxy credentials:', error);
  }
}

function loadProxyCredentialsFromDisk(): void {
  try {
    if (!fs.existsSync(PROXY_CREDENTIALS_FILE)) {
      return;
    }

    const raw = fs.readFileSync(PROXY_CREDENTIALS_FILE, 'utf8');
    const parsed = JSON.parse(raw) as { entries?: ProxyTokenEntry[] };
    const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
    const now = Date.now();

    for (const entry of entries) {
      if (!entry || typeof entry.userId !== 'string' || typeof entry.proxyUser !== 'string' || typeof entry.proxyPassword !== 'string') {
        continue;
      }
      if (!Number.isFinite(entry.expiresAt) || entry.expiresAt <= now) {
        continue;
      }
      if (!Number.isInteger(entry.assignedPort) || !effectiveProxyPorts().includes(entry.assignedPort)) {
        continue;
      }
      if (userIdByAssignedPort.has(entry.assignedPort)) {
        continue;
      }

      proxyCredentialsByUserId.set(entry.userId, {
        userId: entry.userId,
        proxyUser: entry.proxyUser,
        proxyPassword: entry.proxyPassword,
        assignedPort: entry.assignedPort,
        assignedPortExpiresAt: Number.isFinite(entry.assignedPortExpiresAt) ? entry.assignedPortExpiresAt : now + PORT_LEASE_MS,
        expiresAt: entry.expiresAt,
      });
      userIdByCredentialKey.set(credentialKey(entry.proxyUser, entry.proxyPassword), entry.userId);
      userIdByAssignedPort.set(entry.assignedPort, entry.userId);
    }
  } catch (error) {
    console.warn('[interceptProxy] failed to load proxy credentials:', error);
  }
}

function allocatePortForUser(userId: string, excludedPort?: number): number {
  const ports = effectiveProxyPorts();
  const existing = proxyCredentialsByUserId.get(userId);
  if (
    existing
    && ports.includes(existing.assignedPort)
    && existing.assignedPort !== excludedPort
    && existing.assignedPortExpiresAt > Date.now()
  ) {
    return existing.assignedPort;
  }

  for (const port of ports) {
    if (port === excludedPort && ports.length > 1) {
      continue;
    }
    const owner = userIdByAssignedPort.get(port);
    if (!owner || owner === userId) {
      return port;
    }
  }
  throw new Error('proxy_port_pool_exhausted');
}

function pruneExpiredProxyTokens(now = Date.now()): void {
  let changed = false;
  for (const [userId, entry] of proxyCredentialsByUserId.entries()) {
    if (entry.expiresAt <= now) {
      proxyCredentialsByUserId.delete(userId);
      userIdByCredentialKey.delete(credentialKey(entry.proxyUser, entry.proxyPassword));
      userIdByAssignedPort.delete(entry.assignedPort);
      changed = true;
      continue;
    }

    if (entry.assignedPortExpiresAt <= now && userIdByAssignedPort.get(entry.assignedPort) === userId) {
      userIdByAssignedPort.delete(entry.assignedPort);
      changed = true;
    }
  }

  if (changed) {
    persistProxyCredentialsToDisk();
  }
}

function generateProxyPassword(length = 16): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

loadProxyCredentialsFromDisk();

/** Issue (or reuse) proxy credentials for the given userId. */
export function issueProxyToken(
  userId: string,
  preferred?: { proxyUser?: string; proxyPassword?: string },
): {
  proxyUser: string;
  proxyPassword: string;
  assignedPort: number;
  assignedPortExpiresAt: number;
  expiresAt: number;
} {
  pruneExpiredProxyTokens();

  const desiredUser = String(preferred?.proxyUser || '').trim();
  const desiredPassword = String(preferred?.proxyPassword || '').trim();
  const hasPreferred = desiredUser.length > 0 && desiredPassword.length > 0;

  if (hasPreferred) {
    for (const entry of proxyCredentialsByUserId.values()) {
      if (entry.userId !== userId && entry.proxyUser === desiredUser) {
        throw new Error('proxy_username_conflict');
      }
    }
  }

  const existing = proxyCredentialsByUserId.get(userId);
  if (existing) {
    const shouldRotatePort = !effectiveProxyPorts().includes(existing.assignedPort)
      || existing.assignedPortExpiresAt <= Date.now();
    const assignedPort = shouldRotatePort
      ? allocatePortForUser(userId, existing.assignedPort)
      : existing.assignedPort;
    const assignedPortExpiresAt = shouldRotatePort
      ? Date.now() + PORT_LEASE_MS
      : existing.assignedPortExpiresAt;

    if (assignedPort !== existing.assignedPort || assignedPortExpiresAt !== existing.assignedPortExpiresAt) {
      userIdByAssignedPort.delete(existing.assignedPort);
      const migrated = { ...existing, assignedPort, assignedPortExpiresAt };
      proxyCredentialsByUserId.set(userId, migrated);
      userIdByAssignedPort.set(assignedPort, userId);
      persistProxyCredentialsToDisk();
    }

    if (hasPreferred) {
      userIdByCredentialKey.delete(credentialKey(existing.proxyUser, existing.proxyPassword));
      const expiresAt = Date.now() + TOKEN_TTL_MS;
      const next = {
        userId,
        proxyUser: desiredUser,
        proxyPassword: desiredPassword,
        assignedPort,
        assignedPortExpiresAt,
        expiresAt,
      };
      proxyCredentialsByUserId.set(userId, next);
      userIdByCredentialKey.set(credentialKey(next.proxyUser, next.proxyPassword), userId);
      userIdByAssignedPort.set(next.assignedPort, userId);
      persistProxyCredentialsToDisk();
      return {
        proxyUser: next.proxyUser,
        proxyPassword: next.proxyPassword,
        assignedPort: next.assignedPort,
        assignedPortExpiresAt: next.assignedPortExpiresAt,
        expiresAt: next.expiresAt,
      };
    }

    if (existing.expiresAt - Date.now() > TOKEN_REUSE_MIN_TTL_MS) {
      userIdByAssignedPort.set(assignedPort, userId);
      return {
        proxyUser: existing.proxyUser,
        proxyPassword: existing.proxyPassword,
        assignedPort,
        assignedPortExpiresAt,
        expiresAt: existing.expiresAt,
      };
    }

    userIdByCredentialKey.delete(credentialKey(existing.proxyUser, existing.proxyPassword));
    userIdByAssignedPort.delete(existing.assignedPort);
    proxyCredentialsByUserId.delete(userId);
    persistProxyCredentialsToDisk();
  }

  const proxyPassword = hasPreferred ? desiredPassword : generateProxyPassword(16);
  const proxyUser = hasPreferred ? desiredUser : `apik_${uuidv4().replace(/-/g, '').slice(0, 12)}`;
  const assignedPort = allocatePortForUser(userId);
  const assignedPortExpiresAt = Date.now() + PORT_LEASE_MS;
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  proxyCredentialsByUserId.set(userId, { userId, proxyUser, proxyPassword, assignedPort, assignedPortExpiresAt, expiresAt });
  userIdByCredentialKey.set(credentialKey(proxyUser, proxyPassword), userId);
  userIdByAssignedPort.set(assignedPort, userId);
  persistProxyCredentialsToDisk();
  return { proxyUser, proxyPassword, assignedPort, assignedPortExpiresAt, expiresAt };
}

/**
 * Validate a Proxy-Authorization: Basic header.
 * Requires an exact match of issued username + password.
 * Returns the associated userId on success, null on failure.
 */
function validateProxyAuth(authHeader: string | undefined): string | null {
  if (!authHeader?.startsWith('Basic ')) return null;
  pruneExpiredProxyTokens();

  try {
    const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
    const colonIdx = decoded.indexOf(':');
    const password = colonIdx >= 0 ? decoded.slice(colonIdx + 1) : '';
    const username = colonIdx >= 0 ? decoded.slice(0, colonIdx) : decoded;
    if (!username || !password) return null;

    return userIdByCredentialKey.get(credentialKey(username, password)) || null;
  } catch {
    return null;
  }
}

function resolveProxyUserId(
  localPort: number | undefined,
  authHeader: string | undefined,
  remoteAddress?: string,
): string | null {
  const byPort = typeof localPort === 'number' ? userIdByAssignedPort.get(localPort) || null : null;
  const byAuth = validateProxyAuth(authHeader);
  const byWireGuardIp = resolveWireGuardUserIdByClientIp(remoteAddress);

  if (byPort) {
    return byPort;
  }

  if (byAuth) {
    return byAuth;
  }

  if (byWireGuardIp) {
    return byWireGuardIp;
  }

  return null;
}

// ── Per-hostname fake TLS cert ───────────────────────────────────────────────

const certContextCache = new Map<string, tls.SecureContext>();
const certGenerating = new Set<string>();

function safeFilename(hostname: string): string {
  return hostname.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200);
}

/**
 * Generate (or fetch from disk cache) a fake TLS cert for hostname signed by our CA.
 * Returns a SecureContext ready for use in tls.TLSSocket.
 */
function getSecureContextFor(hostname: string): tls.SecureContext | null {
  const cached = certContextCache.get(hostname);
  if (cached) return cached;

  if (!isCaReady() || !fs.existsSync(CA_CERT_PATH) || !fs.existsSync(CA_KEY_PATH)) return null;
  if (certGenerating.has(hostname)) return null;

  certGenerating.add(hostname);
  try {
    fs.mkdirSync(CERT_CACHE_DIR, { recursive: true });

    const safe = safeFilename(hostname);
    const keyPath = path.join(CERT_CACHE_DIR, `${safe}.key`);
    const csrPath = path.join(CERT_CACHE_DIR, `${safe}.csr`);
    const crtPath = path.join(CERT_CACHE_DIR, `${safe}.crt`);
    const extPath = path.join(CERT_CACHE_DIR, `${safe}.ext`);

    if (!fs.existsSync(crtPath)) {
      execSync(`openssl genrsa -out "${keyPath}" 2048`, { stdio: 'pipe' });
      execSync(
        `openssl req -new -key "${keyPath}" -subj "/CN=${hostname}" -out "${csrPath}"`,
        { stdio: 'pipe' },
      );
      // SAN is required by modern devices/OSes.
      fs.writeFileSync(extPath, `subjectAltName=DNS:${hostname}\n`);
      execSync(
        `openssl x509 -req -days 365` +
        ` -in "${csrPath}"` +
        ` -CA "${CA_CERT_PATH}" -CAkey "${CA_KEY_PATH}" -CAcreateserial` +
        ` -out "${crtPath}" -extfile "${extPath}"`,
        { stdio: 'pipe' },
      );
      fs.unlinkSync(csrPath);
      fs.unlinkSync(extPath);
    }

    const ctx = tls.createSecureContext({
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(crtPath),
    });
    certContextCache.set(hostname, ctx);
    return ctx;
  } catch (err) {
    console.error('[Proxy] Cert gen failed for', hostname, err instanceof Error ? err.message : err);
    return null;
  } finally {
    certGenerating.delete(hostname);
  }
}

// ── Traffic capture helpers ──────────────────────────────────────────────────

function captureRequest(
  userId: string,
  method: string,
  url: string,
  headers: http.IncomingHttpHeaders,
  body: Buffer,
): string {
  runtimeStats.captureRequests += 1;
  runtimeStats.lastRequestAt = Date.now();

  const id = uuidv4();
  const safeHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (k === 'proxy-authorization') continue; // never forward credentials
    if (v != null) safeHeaders[k] = Array.isArray(v) ? v.join(', ') : String(v);
  }

  broadcastMobileTraffic(userId, {
    type: 'NEW_INTERCEPTED_REQUEST',
    request: {
      id,
      method: method.toUpperCase(),
      url,
      headers: safeHeaders,
      body: decodeBodyForCapture(headers, body.slice(0, MAX_CAPTURE_BYTES)),
      timestamp: Date.now(),
      status: 'forwarded',
      source: 'mobile-proxy',
    },
  });
  return id;
}

function captureResponse(
  userId: string,
  id: string,
  statusCode: number,
  headers: Record<string, string>,
  body: Buffer,
): void {
  runtimeStats.captureResponses += 1;
  runtimeStats.lastResponseAt = Date.now();

  broadcastMobileTraffic(userId, {
    type: 'MOBILE_PROXY_RESPONSE',
    id,
    statusCode,
    headers,
    body: decodeBodyForCapture(headers, body.slice(0, MAX_CAPTURE_BYTES)),
    timestamp: Date.now(),
  });
}

// ── Core request → upstream forwarding ──────────────────────────────────────

/**
 * Forward an HTTP request to the intended target, capture request + response,
 * and send the response back to the phone.
 *
 * @param baseUrl  For HTTPS MitM requests the path is relative (e.g. /api/v1/foo).
 *                 Pass the base (`https://api.example.com`) so a full URL can be built.
 *                 Omit for plain-HTTP proxy requests where req.url is already absolute.
 */
function handlePlainRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  userId: string,
  baseUrl?: string,
  defaultProtocol: 'http' | 'https' = 'http',
): void {
  runtimeStats.plainHttpRequests += 1;

  const rawUrl = req.url || '/';
  const hostHeader = getHeaderCaseInsensitive(req.headers, 'host');
  const hostAuthority = hostHeader.trim();
  let targetUrl = rawUrl;

  if (rawUrl.startsWith('http')) {
    targetUrl = rawUrl;
  } else if (baseUrl) {
    targetUrl = `${baseUrl}${rawUrl}`;
  } else if (hostAuthority) {
    targetUrl = `${defaultProtocol}://${hostAuthority}${rawUrl}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    res.writeHead(400);
    res.end('Bad Request');
    return;
  }

  // Collect request body (capped).
  const bodyChunks: Uint8Array[] = [];
  let bodyBytes = 0;
  let bodyTruncated = false;

  req.on('data', (chunk: Buffer) => {
    bodyBytes += chunk.length;
    if (bodyBytes <= MAX_CAPTURE_BYTES) {
      bodyChunks.push(toByteArray(chunk));
    } else if (!bodyTruncated) {
      bodyTruncated = true;
      console.warn('[Proxy] Request body truncated for capture (> 10 MB):', targetUrl);
    }
  });

  req.on('end', () => {
    const bodyBuf = concatChunks(bodyChunks);

    // Build outbound headers — strip hop-by-hop and proxy-specific headers.
    const outHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (['proxy-authorization', 'proxy-connection', 'connection', 'keep-alive'].includes(k)) continue;
      if (v != null) outHeaders[k] = Array.isArray(v) ? v.join(', ') : String(v);
    }
    // Request uncompressed responses for clean capture.
    outHeaders['accept-encoding'] = 'identity';

    const id = captureRequest(userId, req.method || 'GET', targetUrl, req.headers, bodyBuf);

    const proto = parsed.protocol === 'https:' ? https : http;
    const upReq = proto.request(
      {
        method: req.method || 'GET',
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: `${parsed.pathname}${parsed.search}`,
        headers: outHeaders,
        rejectUnauthorized: false, // allow self-signed certs on upstream
      },
      (upRes) => {
        const resChunks: Uint8Array[] = [];
        let resBytes = 0;

        upRes.on('data', (c: Buffer) => {
          resBytes += c.length;
          if (resBytes <= MAX_CAPTURE_BYTES) resChunks.push(toByteArray(c));
        });

        upRes.on('end', () => {
          const resBody = concatChunks(resChunks);

          const resHeaders: Record<string, string> = {};
          for (const [k, v] of Object.entries(upRes.headers)) {
            // Remove chunked transfer-encoding — we send a buffered response with content-length.
            if (k === 'transfer-encoding') continue;
            if (v != null) resHeaders[k] = Array.isArray(v) ? v.join(', ') : String(v);
          }
          resHeaders['content-length'] = String(resBody.length);

          captureResponse(userId, id, upRes.statusCode || 0, resHeaders, resBody);

          res.writeHead(upRes.statusCode || 200, resHeaders);
          res.end(resBody);
        });
      },
    );

    upReq.on('error', (e) => {
      runtimeStats.upstreamErrors += 1;
      console.error('[Proxy] Upstream error:', e.message, targetUrl);
      if (!res.headersSent) {
        res.writeHead(502);
        res.end('Bad Gateway');
      }
    });

    if (bodyBuf.length && req.method && !['GET', 'HEAD', 'OPTIONS', 'TRACE'].includes(req.method.toUpperCase())) {
      upReq.write(bodyBuf);
    }
    upReq.end();
  });

  req.on('error', () => {
    if (!res.headersSent) {
      res.writeHead(400);
      res.end();
    }
  });
}

// ── Main proxy server ────────────────────────────────────────────────────────

let _proxyServers: http.Server[] = [];
let _transparentProxyServer: net.Server | null = null;

function looksLikeTlsClientHello(chunk: Buffer): boolean {
  if (chunk.length < 3) return false;
  return chunk[0] === 0x16 && chunk[1] === 0x03;
}

function looksLikeHttpRequest(chunk: Buffer): boolean {
  const prefix = chunk.toString('ascii', 0, Math.min(chunk.length, 16)).toUpperCase();
  return /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|TRACE|CONNECT)\s/.test(prefix);
}

function parseHttpHostFromChunk(chunk: Buffer): string {
  const text = chunk.toString('latin1');
  const match = text.match(/\r\nHost:\s*([^\r\n]+)/i);
  if (!match) return '';
  return String(match[1] || '').trim();
}

function parseTlsSniFromClientHello(chunk: Buffer): string {
  try {
    if (!looksLikeTlsClientHello(chunk) || chunk.length < 11) return '';

    let offset = 0;
    offset += 5; // TLS record header
    offset += 1 + 3; // handshake type + version
    offset += 2 + 32; // random

    if (offset >= chunk.length) return '';
    const sessionIdLength = chunk.readUInt8(offset);
    offset += 1 + sessionIdLength;

    if (offset + 2 > chunk.length) return '';
    const cipherSuitesLength = chunk.readUInt16BE(offset);
    offset += 2 + cipherSuitesLength;

    if (offset >= chunk.length) return '';
    const compressionMethodsLength = chunk.readUInt8(offset);
    offset += 1 + compressionMethodsLength;

    if (offset + 2 > chunk.length) return '';
    const extensionsLength = chunk.readUInt16BE(offset);
    offset += 2;
    const extensionsEnd = Math.min(offset + extensionsLength, chunk.length);

    while (offset + 4 <= extensionsEnd) {
      const extType = chunk.readUInt16BE(offset);
      const extLength = chunk.readUInt16BE(offset + 2);
      offset += 4;

      if (extType === 0x0000) {
        if (offset + 2 > extensionsEnd) return '';
        const sniListLength = chunk.readUInt16BE(offset);
        let sniOffset = offset + 2;
        const sniEnd = Math.min(sniOffset + sniListLength, offset + extLength, extensionsEnd);

        while (sniOffset + 3 <= sniEnd) {
          const nameType = chunk.readUInt8(sniOffset);
          const nameLength = chunk.readUInt16BE(sniOffset + 1);
          sniOffset += 3;

          if (nameType === 0 && sniOffset + nameLength <= sniEnd) {
            return chunk.toString('utf8', sniOffset, sniOffset + nameLength).trim();
          }

          sniOffset += nameLength;
        }

        return '';
      }

      offset += extLength;
    }
  } catch {
    return '';
  }

  return '';
}

function passthroughTransparentSocket(socket: net.Socket, firstChunk: Buffer): void {
  const upstreamFor = (host: string, port: number): net.Socket | null => {
    const safeHost = host.trim();
    if (!safeHost) return null;

    const upstream = net.connect(port, safeHost, () => {
      upstream.write(toByteArray(firstChunk));
      socket.pipe(upstream);
      upstream.pipe(socket);
      socket.resume();
    });

    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
    return upstream;
  };

  socket.pause();

  if (looksLikeTlsClientHello(firstChunk)) {
    const sni = parseTlsSniFromClientHello(firstChunk);
    if (upstreamFor(sni, 443)) {
      return;
    }
    socket.destroy();
    return;
  }

  if (looksLikeHttpRequest(firstChunk)) {
    const hostHeader = parseHttpHostFromChunk(firstChunk);
    const host = hostHeader.split(':')[0] || hostHeader;
    if (upstreamFor(host, 80)) {
      return;
    }
    socket.destroy();
    return;
  }

  socket.destroy();
}

function handleTransparentTlsSocket(socket: net.Socket, userId: string, initialServerName: string): void {
  const initialCtx = getSecureContextFor(initialServerName);
  if (!initialCtx) {
    socket.destroy();
    return;
  }

  let lastSniHostname = '';
  const tlsSocket = new tls.TLSSocket(socket, {
    isServer: true,
    secureContext: initialCtx,
    SNICallback: (servername: string, cb: (err: Error | null, ctx?: tls.SecureContext) => void) => {
      lastSniHostname = String(servername || '').trim();
      const nextCtx = (lastSniHostname && getSecureContextFor(lastSniHostname)) || initialCtx;
      cb(null, nextCtx);
    },
    ALPNProtocols: ['http/1.1'],
  });

  tlsSocket.on('error', () => {
    socket.destroy();
  });

  const localServer = http.createServer((innerReq: http.IncomingMessage, innerRes: http.ServerResponse) => {
    const hostHeader = getHeaderCaseInsensitive(innerReq.headers, 'host').trim();
    const baseUrl = hostHeader
      ? `https://${hostHeader}`
      : (lastSniHostname ? `https://${lastSniHostname}` : undefined);
    handlePlainRequest(innerReq, innerRes, userId, baseUrl, 'https');
  });

  localServer.emit('connection', tlsSocket);
}

function startTransparentWireGuardProxy(): void {
  if (!transparentWireGuardEnabled() || _transparentProxyServer) {
    return;
  }

  const listenPort = transparentWireGuardPort();
  const transparentUserMap = new WeakMap<net.Socket, string>();
  const transparentHttpServer = http.createServer((req: http.IncomingMessage, res: http.ServerResponse) => {
    const userId = transparentUserMap.get(req.socket as net.Socket);
    if (!userId) {
      runtimeStats.authFailures += 1;
      runtimeStats.lastAuthFailureAt = Date.now();
      res.writeHead(407, {
        'Proxy-Authenticate': 'Basic realm="APIK Intercept"',
      });
      res.end();
      return;
    }

    handlePlainRequest(req, res, userId, undefined, 'http');
  });

  _transparentProxyServer = net.createServer((socket: net.Socket) => {
    socket.once('data', (firstChunk: Buffer) => {
      runtimeStats.transparentConnections += 1;

      const userId = resolveProxyUserId(undefined, undefined, socket.remoteAddress);
      if (!userId) {
        // Fail-open path: keep internet working even when WireGuard client is not mapped yet.
        passthroughTransparentSocket(socket, firstChunk);
        return;
      }

      if (looksLikeTlsClientHello(firstChunk)) {
        if (!httpsMitmEnabled()) {
          passthroughTransparentSocket(socket, firstChunk);
          return;
        }

        const initialSni = parseTlsSniFromClientHello(firstChunk);
        const readyForMitm = Boolean(isCaReady() && initialSni && getSecureContextFor(initialSni));
        if (!readyForMitm) {
          // Fail-open path: preserve connectivity even when MitM prerequisites are not ready.
          passthroughTransparentSocket(socket, firstChunk);
          return;
        }

        socket.pause();
        socket.unshift(firstChunk);
        handleTransparentTlsSocket(socket, userId, initialSni);
        socket.resume();
        return;
      }

      if (looksLikeHttpRequest(firstChunk)) {
        socket.pause();
        socket.unshift(firstChunk);
        transparentUserMap.set(socket, userId);
        transparentHttpServer.emit('connection', socket);
        socket.resume();
        return;
      }

      socket.destroy();
    });

    socket.on('error', () => {
      socket.destroy();
    });
  });

  _transparentProxyServer.on('error', (err) => {
    console.error(`[Proxy] Transparent WireGuard listener error on port ${listenPort}:`, err.message);
  });

  _transparentProxyServer.listen(listenPort, '0.0.0.0', () => {
    console.log(`[Proxy] Transparent WireGuard intercept listening on 0.0.0.0:${listenPort}`);
  });
}

export function startInterceptProxy(): void {
  if (_proxyServers.length > 0) return;

  const createProxyServer = (listenPort: number): http.Server => {
    const server = http.createServer(
    (req: http.IncomingMessage, res: http.ServerResponse) => {
      // Plain HTTP proxy request: req.url is the full absolute URL.
      const userId = resolveProxyUserId(
        req.socket.localPort || listenPort,
        typeof req.headers['proxy-authorization'] === 'string'
          ? req.headers['proxy-authorization']
          : undefined,
        req.socket.remoteAddress,
      );
      if (!userId) {
        runtimeStats.authFailures += 1;
        runtimeStats.lastAuthFailureAt = Date.now();
        res.writeHead(407, {
          'Proxy-Authenticate': 'Basic realm="APIK Intercept - use your proxy credentials"',
        });
        res.end();
        return;
      }
      handlePlainRequest(req, res, userId);
    },
  );

  // HTTPS via CONNECT tunnel.
    server.on('connect', (req: http.IncomingMessage, socket: net.Socket, head: Buffer) => {
    runtimeStats.connectTunnels += 1;
    runtimeStats.lastConnectAt = Date.now();

    const userId = resolveProxyUserId(
      socket.localPort || listenPort,
      typeof req.headers['proxy-authorization'] === 'string'
        ? req.headers['proxy-authorization']
        : undefined,
      socket.remoteAddress,
    );
    if (!userId) {
      runtimeStats.authFailures += 1;
      runtimeStats.lastAuthFailureAt = Date.now();
      socket.write(
        'HTTP/1.1 407 Proxy Authentication Required\r\n' +
        'Proxy-Authenticate: Basic realm="APIK Intercept"\r\n' +
        '\r\n',
      );
      socket.destroy();
      return;
    }

    const [hostname, portStr] = (req.url || ':443').split(':');
    const port = Number(portStr) || 443;
    const isIpAddress = /^\d+\.\d+\.\d+\.\d+$/.test(hostname);

    // ── MitM path: present a fake cert signed by APIK CA ──────────────────
    if (!isIpAddress && httpsMitmEnabled() && isCaReady()) {
      const secureCtx = getSecureContextFor(hostname);
      if (secureCtx) {
        socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head?.length) socket.unshift(head);

        // Wrap the phone's socket in a TLS server using our fake cert.
        const tlsSocket = new tls.TLSSocket(socket, {
          isServer: true,
          secureContext: secureCtx,
          // SNI callback handles multi-domain sessions (e.g. HTTP/2 coalescing).
          SNICallback: (servername: string, cb: (err: Error | null, ctx?: tls.SecureContext) => void) => {
            const ctx = getSecureContextFor(servername) ?? secureCtx;
            cb(null, ctx);
          },
          ALPNProtocols: ['http/1.1'], // Force HTTP/1.1 — we don't handle HTTP/2 frames.
        });

        tlsSocket.on('error', (e) => {
          // Ignore common TLS errors (phone disconnected, cert rejection, etc.)
          if (!['ECONNRESET', 'EPIPE'].includes((e as NodeJS.ErrnoException).code ?? '')) {
            console.error('[Proxy] TLS error on', hostname, e.message);
          }
        });

        // Use Node's HTTP parser machinery without binding to a port.
        // Each request from the decrypted stream is handled by handlePlainRequest.
        const localServer = http.createServer(
          (innerReq: http.IncomingMessage, innerRes: http.ServerResponse) => {
            handlePlainRequest(innerReq, innerRes, userId, `https://${hostname}`, 'https');
          },
        );

        localServer.emit('connection', tlsSocket);
        return;
      }
    }

    // ── Blind TCP tunnel (no inspection) ──────────────────────────────────
    const upstream = net.connect(port, hostname, () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head?.length) upstream.write(toByteArray(head));
      upstream.pipe(socket);
      socket.pipe(upstream);

      // Record just the CONNECT metadata (no body to capture).
      captureRequest(userId, 'CONNECT', `${hostname}:${port}`, req.headers, Buffer.alloc(0));
    });

    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
  });

    server.on('error', (err) => {
      console.error(`[Proxy] Server error on port ${listenPort}:`, err.message);
      if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
        blockedProxyPorts.add(listenPort);
        // Prevent assigning users to a port that cannot be bound.
        for (const [userId, entry] of proxyCredentialsByUserId.entries()) {
          if (entry.assignedPort === listenPort) {
            userIdByAssignedPort.delete(listenPort);
            proxyCredentialsByUserId.set(userId, {
              ...entry,
              assignedPortExpiresAt: 0,
            });
          }
        }
        persistProxyCredentialsToDisk();
      }
    });

    server.listen(listenPort, '0.0.0.0', () => {
      console.log(`[Proxy] Intercept proxy listening on 0.0.0.0:${listenPort}`);
    });

    return server;
  };

  _proxyServers = PROXY_PORTS.map((port) => createProxyServer(port));
  startTransparentWireGuardProxy();
  console.log(`[Proxy] Port mode: dedicated-per-user (${PROXY_PORTS[0]}-${PROXY_PORTS[PROXY_PORTS.length - 1]})`);
  if (transparentWireGuardEnabled()) {
    console.log(`[Proxy] WireGuard transparent mode: enabled on TCP ${transparentWireGuardPort()} (requires iptables redirect on wg interface)`);
  }
  console.log('[Proxy] Note: mobile devices must use the VPS public IP or DNS-only host, not a CF-proxied domain.');
}

export function getTransparentWireGuardProxyPort(): number {
  return transparentWireGuardPort();
}
