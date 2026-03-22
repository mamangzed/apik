/**
 * caManager — generates a self-signed local CA and a derived server certificate
 * that is used by the APIK mobile intercept proxy.
 *
 * Files are generated once and cached on disk.  The CA certificate is exposed
 * for download so mobile devices can trust it.
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import os from 'os';

// Where to persist CA / server cert artefacts.
const CA_DIR = process.env.INTERCEPT_CA_DIR
  ? path.resolve(process.env.INTERCEPT_CA_DIR)
  : path.resolve(__dirname, '../../data/intercept-ca');

export const CA_CERT_PATH = path.join(CA_DIR, 'ca.crt');
export const CA_KEY_PATH  = path.join(CA_DIR, 'ca.key');

let _caReady = false;

function run(cmd: string): void {
  execSync(cmd, { stdio: 'pipe' });
}

function opensslAvailable(): boolean {
  try {
    execSync('openssl version', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

export function isCaReady(): boolean {
  return _caReady;
}

export function ensureCa(): void {
  fs.mkdirSync(CA_DIR, { recursive: true });

  const caAlreadyExists = fs.existsSync(CA_CERT_PATH) && fs.existsSync(CA_KEY_PATH);
  if (caAlreadyExists) {
    _caReady = true;
    console.log('[CA] Existing intercept CA loaded from', CA_DIR);
    return;
  }

  if (!opensslAvailable()) {
    console.warn('[CA] openssl not found — skipping CA generation. Install openssl for mobile proxy support.');
    return;
  }

  const commonName = process.env.INTERCEPT_CA_COMMON_NAME || 'APIK Intercept CA';

  try {
    // Generate CA private key.
    run(`openssl genrsa -out "${CA_KEY_PATH}" 2048`);
    fs.chmodSync(CA_KEY_PATH, 0o600);

    // Generate self-signed CA certificate (valid 10 years).
    run(
      `openssl req -new -x509 -days 3650` +
      ` -key "${CA_KEY_PATH}"` +
      ` -out "${CA_CERT_PATH}"` +
      ` -subj "/CN=${commonName}/O=APIK/OU=Intercept"`,
    );
    fs.chmodSync(CA_CERT_PATH, 0o644);

    _caReady = true;
    console.log('[CA] Generated new intercept CA at', CA_DIR);
  } catch (err) {
    console.error('[CA] Failed to generate CA:', err instanceof Error ? err.message : err);
  }
}

export function getCaCertPem(): Buffer | null {
  if (!fs.existsSync(CA_CERT_PATH)) {
    return null;
  }
  try {
    return fs.readFileSync(CA_CERT_PATH);
  } catch {
    return null;
  }
}

/**
 * Returns the public download URL for the CA certificate.
 * Prefers the env var; falls back to the auto-derived URL from server info.
 */
export function resolveCaDownloadUrl(options: {
  protocol: string;
  host: string;
}): string {
  const fromEnv = String(process.env.INTERCEPT_CA_DOWNLOAD_URL || '').trim();
  if (fromEnv) {
    return fromEnv;
  }

  const hostname = options.host.split(':')[0] || os.hostname();
  const proto = options.protocol === 'https' ? 'https' : 'http';
  const port = process.env.PORT || '2611';
  const portSuffix =
    (proto === 'https' && port === '443') || (proto === 'http' && port === '80')
      ? ''
      : `:${port}`;

  return `${proto}://${hostname}${portSuffix}/downloads/apik-ca.crt`;
}
