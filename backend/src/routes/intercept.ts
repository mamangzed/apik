import { Router, Request, Response } from 'express';
import net from 'net';
import { requireUser, requireUserId } from '../lib/auth';
import { issueInterceptSession } from '../websocket/intercept';
import { resolveCaDownloadUrl, isCaReady } from '../lib/caManager';
import { issueProxyToken, getInterceptProxyStats, getProxyPortPoolStats } from '../lib/interceptProxy';
import { ensureWireGuardProfile, getWireGuardTransparentRedirectState } from '../lib/wireguardManager';

const router = Router();

function boolFromEnv(value: string | undefined, defaultValue: boolean): boolean {
  if (!value) return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return defaultValue;
}

function httpsMitmEnabled(): boolean {
  return boolFromEnv(process.env.INTERCEPT_PROXY_HTTPS_MITM_ENABLE, false);
}

function resolveProxyEndpoint(req: Request): {
  host: string;
  hostSource: 'env' | 'request';
  port: number;
} {
  const hostFromEnv = String(process.env.INTERCEPT_PROXY_HOST || '').trim();
  const hostFromRequest = String(req.headers.host || '').split(':')[0] || req.hostname || 'localhost';
  const host = hostFromEnv || hostFromRequest;
  const hostSource: 'env' | 'request' = hostFromEnv ? 'env' : 'request';
  const port = Number(process.env.INTERCEPT_PROXY_PORT || '8080');
  return { host, hostSource, port };
}

function resolveWireGuardTunnelProxyHost(): string | null {
  const explicit = String(process.env.INTERCEPT_WIREGUARD_SERVER_IP || '').trim();
  if (explicit) {
    return explicit;
  }

  const subnet = String(process.env.INTERCEPT_WIREGUARD_SUBNET || process.env.WIREGUARD_SUBNET_CIDR || '10.66.66.0/24').trim();
  const matched = subnet.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}\/\d{1,2}$/);
  if (!matched) {
    return null;
  }
  return `${matched[1]}.1`;
}

async function probeProxyEndpoint(host: string, port: number): Promise<{ ok: boolean; error?: string; latencyMs: number }> {
  const startedAt = Date.now();
  const timeoutMs = 2500;

  const probe = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const finish = (value: { ok: boolean; error?: string }) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(value);
    };

    socket.setTimeout(timeoutMs);

    socket.once('connect', () => {
      finish({ ok: true });
    });

    socket.once('timeout', () => {
      finish({ ok: false, error: 'timeout' });
    });

    socket.once('error', (error: NodeJS.ErrnoException) => {
      finish({ ok: false, error: error.code || error.message || 'connection_error' });
    });

    socket.connect(port, host);
  });

  return {
    ...probe,
    latencyMs: Date.now() - startedAt,
  };
}

function monitorAuthorized(req: Request): boolean {
  const expected = String(process.env.INTERCEPT_MONITOR_KEY || '').trim();
  if (!expected) {
    return true;
  }

  const fromHeader = String(req.headers['x-monitor-key'] || '').trim();
  const fromQuery = String(req.query.key || '').trim();
  return fromHeader === expected || fromQuery === expected;
}

function validProxyUsername(value: string): boolean {
  return /^[a-zA-Z0-9_.-]{3,40}$/.test(value);
}

function validProxyPassword(value: string): boolean {
  return value.length >= 6 && value.length <= 64 && !/\s/.test(value);
}

function buildProxySetupResponse(
  req: Request,
  userId: string,
  proxyUser: string,
  proxyPassword: string,
  tokenExpiresAt: number,
  assignedPort?: number,
  assignedPortExpiresAt?: number,
) {
  const { host, hostSource, port: defaultPort } = resolveProxyEndpoint(req);
  const port = assignedPort || defaultPort;
  const caCommonName = String(process.env.INTERCEPT_CA_COMMON_NAME || 'APIK Intercept CA').trim();
  const caDownloadUrl = resolveCaDownloadUrl({
    protocol: req.protocol || 'http',
    host: req.headers.host || host,
  });
  const mitmEnabled = httpsMitmEnabled();
  const wireguardProfile = ensureWireGuardProfile(userId, host);
  const wireGuardTunnelHost = resolveWireGuardTunnelProxyHost();
  const wireGuardConnected = Boolean(wireguardProfile.tunnelConnected);
  const transparentRedirect = getWireGuardTransparentRedirectState();
  const transparentInterceptEnabled = Boolean(transparentRedirect.enabled && transparentRedirect.configured);
  const preferWireGuardHost = Boolean(wireguardProfile.enabled && wireGuardConnected && wireGuardTunnelHost);
  const recommendedProxyHost = preferWireGuardHost ? wireGuardTunnelHost! : host;
  const recommendedProxySource: 'wireguard' | 'public' = preferWireGuardHost ? 'wireguard' : 'public';
  const wireguard = {
    enabled: wireguardProfile.enabled,
    available: wireguardProfile.available,
    reason: wireguardProfile.reason,
    interfaceName: wireguardProfile.interfaceName,
    endpointHost: wireguardProfile.endpointHost,
    endpointPort: wireguardProfile.endpointPort,
    clientName: wireguardProfile.clientName,
    proxyHost: wireGuardTunnelHost,
    proxyPort: port,
    requiresManualProxy: !transparentInterceptEnabled,
    transparentInterceptEnabled,
    transparentInterceptPort: transparentRedirect.redirectPort,
    transparentInterceptReason: transparentRedirect.reason,
    tunnelConnected: wireGuardConnected,
    lastHandshakeAt: wireguardProfile.lastHandshakeAt || null,
    downloadPath: wireguardProfile.downloadPath,
    configText: wireguardProfile.configText,
  };

  const warnings: string[] = [];
  const portPool = getProxyPortPoolStats();
  if (hostSource === 'request' && typeof req.headers['cf-ray'] === 'string') {
    warnings.push(
      'Cloudflare proxy detected and INTERCEPT_PROXY_HOST is not set. Use a DNS-only/grey-cloud proxy host (for example proxy.example.com) to avoid CONNECT tunnel failures.',
    );
  }

  return {
    host,
    recommendedProxyHost,
    recommendedProxyPort: port,
    recommendedProxySource,
    hostSource,
    port,
    portMode: portPool.mode,
    portRange: portPool.range,
    portPool,
    proxyUser,
    proxyPassword,
    portExpiresAt: assignedPortExpiresAt || null,
    tokenExpiresAt,
    caDownloadUrl: isCaReady() ? caDownloadUrl : null,
    caCommonName,
    httpsMitmEnabled: mitmEnabled,
    proxyUrl: `http://${host}:${port}`,
    caReady: isCaReady(),
    notes: [
      mitmEnabled
        ? 'Install and trust certificate authority (CA) on the phone before HTTPS intercept.'
        : 'HTTPS MITM is currently disabled for stability, so HTTPS traffic will pass through without body inspection.',
      'WireGuard profile is generated automatically per user when opening this setup panel.',
      transparentInterceptEnabled
        ? 'WireGuard transparent intercept is active: after tunnel is connected, you can keep phone proxy set to Off/None.'
        : 'WireGuard currently secures only network path; manual proxy is still required on phone.',
      transparentInterceptEnabled
        ? 'If no traffic appears, verify server iptables PREROUTING redirect is active for WireGuard tcp/80 and tcp/443.'
        : 'If using WireGuard, connect the tunnel first, then keep Manual Proxy enabled using the WireGuard proxy host and your assigned port.',
      'Do not share WireGuard profiles between users.',
      'Apps with certificate pinning may still bypass inspection.',
      'Use this proxy only on networks and devices you own or are authorized to test.',
    ],
    wireguard,
    warnings,
  };
}

router.get('/monitor', async (req: Request, res: Response) => {
  if (!monitorAuthorized(req)) {
    res.status(401).json({ error: 'monitor key required' });
    return;
  }

  const { host, hostSource, port } = resolveProxyEndpoint(req);
  const probe = await probeProxyEndpoint(host, port);
  const stats = getInterceptProxyStats();
  const portPool = getProxyPortPoolStats();

  res.json({
    host,
    hostSource,
    port,
    ok: probe.ok,
    status: probe.ok ? 'reachable' : 'unreachable',
    latencyMs: probe.latencyMs,
    checkedAt: new Date().toISOString(),
    error: probe.error || null,
    stats,
    portPool,
  });
});

router.use(requireUser);

router.get('/session', (req: Request, res: Response) => {
  const userId = requireUserId(req);
  const { host } = resolveProxyEndpoint(req);
  void ensureWireGuardProfile(userId, host);
  const { ticket, expiresAt } = issueInterceptSession(userId);
  res.json({
    userId,
    ticket,
    expiresAt,
  });
});

router.get('/proxy-setup', (req: Request, res: Response) => {
  const userId = requireUserId(req);
  try {
    const {
      proxyUser,
      proxyPassword,
      assignedPort,
      assignedPortExpiresAt,
      expiresAt: tokenExpiresAt,
    } = issueProxyToken(userId);
    res.json(buildProxySetupResponse(req, userId, proxyUser, proxyPassword, tokenExpiresAt, assignedPort, assignedPortExpiresAt));
  } catch (error) {
    if (error instanceof Error && error.message === 'proxy_port_pool_exhausted') {
      res.status(503).json({ error: 'Proxy port range exhausted. Increase INTERCEPT_PROXY_PORT_RANGE.' });
      return;
    }
    res.status(500).json({ error: 'Failed to load proxy setup.' });
  }
});

router.post('/proxy-setup', (req: Request, res: Response) => {
  const userId = requireUserId(req);
  const body = (req.body || {}) as { proxyUser?: unknown; proxyPassword?: unknown };
  const proxyUser = String(body.proxyUser || '').trim();
  const proxyPassword = String(body.proxyPassword || '').trim();

  if (!validProxyUsername(proxyUser)) {
    res.status(400).json({
      error: 'Invalid proxy username. Use 3-40 chars: letters, numbers, underscore, dot, dash.',
    });
    return;
  }

  if (!validProxyPassword(proxyPassword)) {
    res.status(400).json({
      error: 'Invalid proxy password. Use 6-64 chars without spaces.',
    });
    return;
  }

  try {
    const {
      proxyUser: savedUser,
      proxyPassword: savedPassword,
      assignedPort,
      assignedPortExpiresAt,
      expiresAt: tokenExpiresAt,
    } = issueProxyToken(userId, {
      proxyUser,
      proxyPassword,
    });
    res.json(buildProxySetupResponse(req, userId, savedUser, savedPassword, tokenExpiresAt, assignedPort, assignedPortExpiresAt));
  } catch (error) {
    if (error instanceof Error && error.message === 'proxy_username_conflict') {
      res.status(409).json({ error: 'Proxy username already used by another user.' });
      return;
    }
    if (error instanceof Error && error.message === 'proxy_port_pool_exhausted') {
      res.status(503).json({ error: 'Proxy port range exhausted. Increase INTERCEPT_PROXY_PORT_RANGE.' });
      return;
    }
    res.status(500).json({ error: 'Failed to save proxy credentials.' });
  }
});

router.get('/wireguard/config', (req: Request, res: Response) => {
  const userId = requireUserId(req);
  const { host: endpointHost } = resolveProxyEndpoint(req);
  const profile = ensureWireGuardProfile(userId, endpointHost);

  if (!profile.enabled) {
    res.status(404).json({ error: 'WireGuard is disabled on this server.' });
    return;
  }

  if (!profile.available || !profile.configText) {
    res.status(503).json({ error: `WireGuard profile unavailable: ${profile.reason || 'unknown_error'}` });
    return;
  }

  const filename = `${profile.clientName || 'wireguard'}.conf`;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(profile.configText);
});

router.get('/proxy-health', async (req: Request, res: Response) => {
  const userId = requireUserId(req);
  const { host } = resolveProxyEndpoint(req);
  let port: number;
  try {
    ({ assignedPort: port } = issueProxyToken(userId));
  } catch (error) {
    if (error instanceof Error && error.message === 'proxy_port_pool_exhausted') {
      res.status(503).json({ error: 'Proxy port range exhausted. Increase INTERCEPT_PROXY_PORT_RANGE.' });
      return;
    }
    res.status(500).json({ error: 'Failed to resolve proxy health target.' });
    return;
  }
  const probe = await probeProxyEndpoint(host, port);
  const stats = getInterceptProxyStats();

  res.json({
    host,
    port,
    ok: probe.ok,
    status: probe.ok ? 'reachable' : 'unreachable',
    latencyMs: probe.latencyMs,
    checkedAt: new Date().toISOString(),
    error: probe.error || null,
    stats,
  });
});

export default router;