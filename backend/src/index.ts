import 'express-async-errors';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import path from 'path';
import fs from 'fs';
import { config as loadEnv } from 'dotenv';
import { clerkMiddleware } from '@clerk/express';
import proxyRouter from './routes/proxy';
import collectionsRouter from './routes/collections';
import environmentsRouter from './routes/environments';
import publicRouter from './routes/public';
import syncRouter from './routes/sync';
import interceptRouter from './routes/intercept';
import { setupWebSocket } from './websocket/intercept';
import { ensureCa, CA_CERT_PATH, getCaCertPem } from './lib/caManager';
import { startInterceptProxy } from './lib/interceptProxy';
import { ensureWireGuardTransparentRedirect } from './lib/wireguardManager';
import { enforceImmutableBrandingEnv } from './lib/brandGuard';

loadEnv({ path: path.resolve(__dirname, '../.env') });
loadEnv({ path: path.resolve(__dirname, '../../.env') });

// Block startup when branding is overridden via script/env variables.
enforceImmutableBrandingEnv();

// Generate intercept CA on boot (no-op if already exists or openssl unavailable).
ensureCa();

// Start per-user MitM proxy server on INTERCEPT_PROXY_PORT (default 8080).
startInterceptProxy();

const wireGuardRedirect = ensureWireGuardTransparentRedirect();
if (wireGuardRedirect.enabled && wireGuardRedirect.configured) {
  console.log(`[WireGuard] Transparent intercept redirect active on ${wireGuardRedirect.interfaceName}: tcp/80,tcp/443 -> ${wireGuardRedirect.redirectPort}`);
} else if (wireGuardRedirect.enabled && !wireGuardRedirect.configured) {
  console.warn(`[WireGuard] Transparent intercept redirect not active: ${wireGuardRedirect.reason || 'unknown_error'}`);
}

const app = express();
const PORT = process.env.PORT || 2611;
const HOST = process.env.HOST || '0.0.0.0';
const isProduction = process.env.NODE_ENV === 'production';
const frontendDist = path.resolve(__dirname, '../../frontend/dist');
const hasFrontendDist = fs.existsSync(frontendDist);
const clerkConfigured = Boolean(process.env.CLERK_SECRET_KEY || process.env.CLERK_PUBLISHABLE_KEY);

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
if (clerkConfigured) {
  app.use(clerkMiddleware());
}
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', version: '1.0.0', timestamp: new Date().toISOString() });
});

// Serve intercept CA certificate (DER or PEM) for mobile device trust.
// Public endpoint — no auth required so phones can download via browser.
app.get('/downloads/apik-ca.crt', (_req, res) => {
  const pem = getCaCertPem();
  if (!pem) {
    res.status(404).json({ error: 'CA certificate not yet generated' });
    return;
  }
  res.setHeader('Content-Type', 'application/x-x509-ca-cert');
  res.setHeader('Content-Disposition', 'attachment; filename="apik-ca.crt"');
  res.send(pem);
});

// Expose raw CA cert path info for ops tooling (non-secret).
app.get('/downloads/apik-ca-info', (_req, res) => {
  const pem = getCaCertPem();
  res.json({
    available: Boolean(pem),
    path: CA_CERT_PATH,
    downloadUrl: '/downloads/apik-ca.crt',
  });
});

// Routes
app.use('/api/proxy', proxyRouter);
app.use('/api/intercept', interceptRouter);
app.use('/api/public', publicRouter);
app.use('/api/sync', syncRouter);
app.use('/api/collections', collectionsRouter);
app.use('/api/environments', environmentsRouter);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const asRecord = (typeof err === 'object' && err !== null ? err as Record<string, unknown> : null);
  const supabaseCode = typeof asRecord?.code === 'string' ? asRecord.code : '';
  const message = err instanceof Error
    ? err.message
    : (typeof asRecord?.message === 'string' ? asRecord.message : 'Internal server error');

  if (supabaseCode === 'PGRST205') {
    if (!res.headersSent) {
      res.status(500).json({
        error: 'Supabase schema is not initialized. Run supabase/schema.sql in your Supabase SQL editor.',
        code: supabaseCode,
      });
    }
    return;
  }

  console.error('[HTTP] Unhandled error:', err);
  if (!res.headersSent) {
    res.status(500).json({ error: message });
  }
});

if (hasFrontendDist) {
  app.use(express.static(frontendDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/ws')) {
      next();
      return;
    }

    res.sendFile(path.join(frontendDist, 'index.html'));
  });
}

// Create HTTP server with WebSocket support
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws/intercept' });
setupWebSocket(wss);

// Start
server.listen(Number(PORT), HOST, () => {
  const displayHost = HOST === '0.0.0.0' ? 'localhost' : HOST;
  console.log(`\nAPIK Backend running on http://${displayHost}:${PORT}`);
  console.log(`Listening on ${HOST}:${PORT}`);
  console.log(`WebSocket intercept: ws://${displayHost}:${PORT}/ws/intercept`);
  console.log(`Storage: Supabase`);
  if (hasFrontendDist) {
    console.log(`Frontend: serving ${frontendDist}`);
  }
  console.log('');
});

process.on('unhandledRejection', (reason) => {
  console.error('[Process] Unhandled rejection:', reason);
});

export default app;
