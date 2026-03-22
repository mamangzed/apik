import fs from 'fs';
import os from 'os';
import path from 'path';
import { createHash } from 'crypto';
import { execSync } from 'child_process';

interface WireGuardRegistryEntry {
  userId: string;
  clientName: string;
  clientIp: string;
  privateKey: string;
  publicKey: string;
  psk: string;
  createdAt: number;
  updatedAt: number;
}

interface WireGuardTransparentRedirectState {
  enabled: boolean;
  configured: boolean;
  interfaceName: string;
  redirectPort: number;
  reason?: string;
}

type WireGuardRegistry = Record<string, WireGuardRegistryEntry>;

let lastTransparentRedirectState: WireGuardTransparentRedirectState | null = null;

export interface WireGuardProfileResult {
  enabled: boolean;
  available: boolean;
  reason?: string;
  interfaceName?: string;
  endpointHost?: string;
  endpointPort?: number;
  clientName?: string;
  clientIp?: string;
  tunnelConnected?: boolean;
  lastHandshakeAt?: number | null;
  downloadPath?: string;
  configText?: string;
}

function boolFromEnv(value: string | undefined, defaultValue: boolean): boolean {
  if (!value) return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return defaultValue;
}

function wireGuardEnabled(): boolean {
  const explicit = process.env.INTERCEPT_WIREGUARD_ENABLE;
  if (explicit != null) {
    return boolFromEnv(explicit, false);
  }
  return boolFromEnv(process.env.WIREGUARD_ENABLE, false);
}

function wireGuardInterface(): string {
  return String(process.env.INTERCEPT_WIREGUARD_INTERFACE || process.env.WIREGUARD_INTERFACE || 'wg0').trim();
}

function wireGuardTransparentEnabled(): boolean {
  const explicit = process.env.INTERCEPT_WIREGUARD_TRANSPARENT_ENABLE;
  if (explicit != null) {
    return boolFromEnv(explicit, false);
  }
  return false;
}

function wireGuardTransparentPort(): number {
  const parsed = Number(process.env.INTERCEPT_WIREGUARD_TRANSPARENT_PORT || '18080');
  if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535) {
    return parsed;
  }
  return 18080;
}

function wireGuardConfPath(): string {
  return String(process.env.INTERCEPT_WIREGUARD_CONF || '').trim() || `/etc/wireguard/${wireGuardInterface()}.conf`;
}

function wireGuardSubnetPrefix(): string {
  const subnet = String(process.env.INTERCEPT_WIREGUARD_SUBNET || process.env.WIREGUARD_SUBNET_CIDR || '10.66.66.0/24').trim();
  const matched = subnet.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}\/\d{1,2}$/);
  if (matched) return matched[1];
  return '10.66.66';
}

function wireGuardRegistryPath(): string {
  return path.resolve(__dirname, '../../data/wireguard-users.json');
}

function normalizeIpv4FromSocketAddress(raw: string | undefined | null): string {
  const value = String(raw || '').trim();
  if (!value) {
    return '';
  }

  const mappedPrefix = '::ffff:';
  if (value.toLowerCase().startsWith(mappedPrefix)) {
    return value.slice(mappedPrefix.length);
  }

  return value;
}

function loadRegistry(): WireGuardRegistry {
  try {
    const filePath = wireGuardRegistryPath();
    if (!fs.existsSync(filePath)) {
      return {};
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as WireGuardRegistry;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function resolveWireGuardUserIdByClientIp(clientIpRaw: string | undefined | null): string | null {
  const clientIp = normalizeIpv4FromSocketAddress(clientIpRaw);
  if (!clientIp) {
    return null;
  }

  const registry = loadRegistry();
  for (const entry of Object.values(registry)) {
    if (entry.clientIp === clientIp) {
      return entry.userId;
    }
  }

  return null;
}

function saveRegistry(registry: WireGuardRegistry): void {
  const filePath = wireGuardRegistryPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(registry, null, 2), 'utf8');
}

function hasCommand(command: string): boolean {
  try {
    execSync(`command -v ${command}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function ensureIptablesRedirectRule(interfaceName: string, destinationPort: number, redirectPort: number): void {
  const checkCommand = `iptables -t nat -C PREROUTING -i ${interfaceName} -p tcp --dport ${destinationPort} -j REDIRECT --to-ports ${redirectPort}`;
  const addCommand = `iptables -t nat -A PREROUTING -i ${interfaceName} -p tcp --dport ${destinationPort} -j REDIRECT --to-ports ${redirectPort}`;
  try {
    execSync(checkCommand, { stdio: 'ignore' });
  } catch {
    execSync(addCommand, { stdio: 'ignore' });
  }
}

function removeIptablesRedirectRules(interfaceName: string, destinationPort: number): void {
  const output = execSync('iptables -t nat -S PREROUTING', { encoding: 'utf8' });
  const lines = output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => (
      line.startsWith('-A PREROUTING ')
      && line.includes(`-i ${interfaceName} `)
      && line.includes(`-p tcp `)
      && line.includes(`--dport ${destinationPort} `)
      && line.includes('-j REDIRECT')
    ));

  for (const line of lines) {
    const deleteRule = line.replace(/^-A\s+PREROUTING\s+/, '-D PREROUTING ');
    try {
      execSync(`iptables -t nat ${deleteRule}`, { stdio: 'ignore' });
    } catch {
      // Ignore race conditions when a rule was already removed.
    }
  }
}

export function ensureWireGuardTransparentRedirect(): {
  enabled: boolean;
  configured: boolean;
  interfaceName: string;
  redirectPort: number;
  reason?: string;
} {
  const interfaceName = wireGuardInterface();
  const redirectPort = wireGuardTransparentPort();
  const disableAndCleanup = (reason: string) => {
    try {
      removeIptablesRedirectRules(interfaceName, 80);
      removeIptablesRedirectRules(interfaceName, 443);
    } catch {
      // Ignore cleanup failures and report disabled state.
    }
    lastTransparentRedirectState = {
      enabled: false,
      configured: false,
      interfaceName,
      redirectPort,
      reason,
    };
    return lastTransparentRedirectState;
  };

  if (!wireGuardEnabled()) {
    return disableAndCleanup('wireguard_disabled');
  }

  if (!wireGuardTransparentEnabled()) {
    return disableAndCleanup('transparent_disabled');
  }

  if (!hasCommand('iptables')) {
    lastTransparentRedirectState = {
      enabled: true,
      configured: false,
      interfaceName,
      redirectPort,
      reason: 'iptables_missing',
    };
    return lastTransparentRedirectState;
  }

  try {
    // Replace any stale redirect rules to keep a single canonical destination port.
    removeIptablesRedirectRules(interfaceName, 80);
    removeIptablesRedirectRules(interfaceName, 443);
    ensureIptablesRedirectRule(interfaceName, 80, redirectPort);
    ensureIptablesRedirectRule(interfaceName, 443, redirectPort);
    lastTransparentRedirectState = {
      enabled: true,
      configured: true,
      interfaceName,
      redirectPort,
    };
    return lastTransparentRedirectState;
  } catch (error) {
    lastTransparentRedirectState = {
      enabled: true,
      configured: false,
      interfaceName,
      redirectPort,
      reason: error instanceof Error ? error.message : 'iptables_config_failed',
    };
    return lastTransparentRedirectState;
  }
}

export function getWireGuardTransparentRedirectState(): WireGuardTransparentRedirectState {
  if (lastTransparentRedirectState) {
    return lastTransparentRedirectState;
  }

  return {
    enabled: wireGuardEnabled() && wireGuardTransparentEnabled(),
    configured: false,
    interfaceName: wireGuardInterface(),
    redirectPort: wireGuardTransparentPort(),
    reason: 'not_initialized',
  };
}

function sanitizeClientName(userId: string): string {
  const hash = createHash('sha1').update(userId).digest('hex').slice(0, 12);
  return `user-${hash}`;
}

function allocateClientIp(registry: WireGuardRegistry): string {
  const prefix = wireGuardSubnetPrefix();
  const used = new Set(Object.values(registry).map((entry) => entry.clientIp));
  for (let i = 2; i <= 254; i += 1) {
    const candidate = `${prefix}.${i}`;
    if (!used.has(candidate)) {
      return candidate;
    }
  }
  throw new Error('wireguard_ip_pool_exhausted');
}

function appendPeerToConfIfMissing(confPath: string, entry: WireGuardRegistryEntry): void {
  const peerBlock = [
    '',
    `# APIK user ${entry.userId}`,
    '[Peer]',
    `PublicKey = ${entry.publicKey}`,
    `PresharedKey = ${entry.psk}`,
    `AllowedIPs = ${entry.clientIp}/32`,
    '',
  ].join('\n');

  let current = '';
  if (fs.existsSync(confPath)) {
    current = fs.readFileSync(confPath, 'utf8');
  }

  if (current.includes(`PublicKey = ${entry.publicKey}`)) {
    return;
  }

  fs.writeFileSync(confPath, `${current.trimEnd()}${peerBlock}`, 'utf8');
}

function syncWireGuardPeers(interfaceName: string, confPath: string): void {
  const registry = loadRegistry();
  const entries = Object.values(registry).filter((entry) => (
    Boolean(entry && entry.userId && entry.publicKey && entry.psk && entry.clientIp)
  ));
  const validPublicKeys = new Set(entries.map((entry) => entry.publicKey));

  // Remove stale live peers that are not registered in APIK anymore.
  try {
    const liveOutput = execSync(`wg show ${interfaceName} peers`, { encoding: 'utf8' }).trim();
    const livePeers = liveOutput ? liveOutput.split(/\s+/).map((value) => value.trim()).filter(Boolean) : [];
    for (const peerPublicKey of livePeers) {
      if (!validPublicKeys.has(peerPublicKey)) {
        execSync(`wg set ${interfaceName} peer ${peerPublicKey} remove`, { stdio: 'ignore' });
      }
    }
  } catch {
    // Ignore runtime cleanup failures when interface is down.
  }

  if (!fs.existsSync(confPath)) {
    return;
  }

  const raw = fs.readFileSync(confPath, 'utf8');
  const lines = raw.split('\n');
  const firstPeerIndex = lines.findIndex((line) => line.trim() === '[Peer]');
  const header = (firstPeerIndex >= 0 ? lines.slice(0, firstPeerIndex).join('\n') : raw).trimEnd();

  const peerBlocks: string[] = [];
  if (firstPeerIndex >= 0) {
    let current: string[] = [];
    for (let index = firstPeerIndex; index < lines.length; index += 1) {
      const line = lines[index];
      if (line.trim() === '[Peer]' && current.length > 0) {
        peerBlocks.push(current.join('\n').trimEnd());
        current = [line];
      } else {
        current.push(line);
      }
    }
    if (current.length > 0) {
      peerBlocks.push(current.join('\n').trimEnd());
    }
  }

  const keptBlocks: string[] = [];
  const keptPublicKeys = new Set<string>();
  for (const block of peerBlocks) {
    const keyMatch = block.match(/^\s*PublicKey\s*=\s*(\S+)\s*$/m);
    const peerPublicKey = keyMatch ? keyMatch[1].trim() : '';
    if (!peerPublicKey || !validPublicKeys.has(peerPublicKey)) {
      continue;
    }
    keptPublicKeys.add(peerPublicKey);
    keptBlocks.push(block);
  }

  for (const entry of entries) {
    if (keptPublicKeys.has(entry.publicKey)) {
      continue;
    }
    keptBlocks.push([
      `# APIK user ${entry.userId}`,
      '[Peer]',
      `PublicKey = ${entry.publicKey}`,
      `PresharedKey = ${entry.psk}`,
      `AllowedIPs = ${entry.clientIp}/32`,
    ].join('\n'));
  }

  const rebuilt = keptBlocks.length > 0
    ? `${header}\n\n${keptBlocks.join('\n\n')}\n`
    : `${header}\n`;
  fs.writeFileSync(confPath, rebuilt, 'utf8');
}

function interfaceIsUp(interfaceName: string): boolean {
  try {
    execSync(`wg show ${interfaceName}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the server public key. Tries the live interface first, then falls back to
 * reading the server private key file that the deploy script writes to
 * /etc/wireguard/<iface>.server.key — works even when the interface is down.
 */
function getServerPublicKey(interfaceName: string): string {
  try {
    const key = execSync(`wg show ${interfaceName} public-key`, { encoding: 'utf8' }).trim();
    if (key) return key;
  } catch {
    // fallback to key file
  }
  const keyFile = `/etc/wireguard/${interfaceName}.server.key`;
  if (fs.existsSync(keyFile)) {
    const privateKey = fs.readFileSync(keyFile, 'utf8').trim();
    return execSync('wg pubkey', { input: privateKey, encoding: 'utf8' }).trim();
  }
  throw new Error('wireguard_server_key_not_found');
}

function currentListenPort(interfaceName: string): number {
  try {
    const output = execSync(`wg show ${interfaceName} listen-port`, { encoding: 'utf8' }).trim();
    const parsed = Number(output);
    if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65535) {
      return parsed;
    }
  } catch {
    // ignore and fallback
  }

  const fromEnv = Number(process.env.INTERCEPT_WIREGUARD_PORT || process.env.WIREGUARD_PORT || '443');
  if (Number.isInteger(fromEnv) && fromEnv > 0 && fromEnv <= 65535) {
    return fromEnv;
  }
  return 443;
}

function applyPeerLive(interfaceName: string, entry: WireGuardRegistryEntry): void {
  const tmpPsk = path.join(os.tmpdir(), `apik-${interfaceName}-${entry.clientName}.psk`);
  fs.writeFileSync(tmpPsk, entry.psk, { mode: 0o600 });

  try {
    execSync(
      `wg set ${interfaceName} peer ${entry.publicKey} preshared-key ${tmpPsk} allowed-ips ${entry.clientIp}/32`,
      { stdio: 'ignore' },
    );
  } finally {
    try {
      fs.unlinkSync(tmpPsk);
    } catch {
      // ignore cleanup issues
    }
  }
}

function getLatestHandshakeEpoch(interfaceName: string, publicKey: string): number {
  try {
    const output = execSync(`wg show ${interfaceName} latest-handshakes`, { encoding: 'utf8' }).trim();
    if (!output) return 0;
    const row = output
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.startsWith(`${publicKey}\t`) || line.startsWith(`${publicKey} `));
    if (!row) return 0;
    const parts = row.split(/\s+/);
    const epoch = Number(parts[1]);
    return Number.isFinite(epoch) ? epoch : 0;
  } catch {
    return 0;
  }
}

function getPeerEndpoint(interfaceName: string, publicKey: string): string {
  try {
    const output = execSync(`wg show ${interfaceName} endpoints`, { encoding: 'utf8' }).trim();
    if (!output) return '';
    const row = output
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.startsWith(`${publicKey}\t`) || line.startsWith(`${publicKey} `));
    if (!row) return '';
    const parts = row.split(/\s+/);
    return String(parts[1] || '').trim();
  } catch {
    return '';
  }
}

function buildClientConfig(entry: WireGuardRegistryEntry, endpointHost: string, endpointPort: number, serverPublicKey: string): string {
  return [
    '[Interface]',
    `PrivateKey = ${entry.privateKey}`,
    `Address = ${entry.clientIp}/32`,
    'DNS = 1.1.1.1, 8.8.8.8',
    '',
    '[Peer]',
    `PublicKey = ${serverPublicKey}`,
    `PresharedKey = ${entry.psk}`,
    `Endpoint = ${endpointHost}:${endpointPort}`,
    'AllowedIPs = 0.0.0.0/0, ::/0',
    'PersistentKeepalive = 25',
    '',
  ].join('\n');
}

function ensureUserProfile(userId: string): WireGuardRegistryEntry {
  const now = Date.now();
  const registry = loadRegistry();
  const existing = registry[userId];
  if (existing && existing.privateKey && existing.publicKey && existing.psk && existing.clientIp) {
    // Keep existing profile stable to avoid unnecessary writes on frequent status polling.
    return existing;
  }

  const privateKey = execSync('wg genkey', { encoding: 'utf8' }).trim();
  const publicKey = execSync('wg pubkey', { input: privateKey, encoding: 'utf8' }).trim();
  const psk = execSync('wg genpsk', { encoding: 'utf8' }).trim();

  const created: WireGuardRegistryEntry = {
    userId,
    clientName: sanitizeClientName(userId),
    clientIp: allocateClientIp(registry),
    privateKey,
    publicKey,
    psk,
    createdAt: now,
    updatedAt: now,
  };

  registry[userId] = created;
  saveRegistry(registry);
  return created;
}

export function ensureWireGuardProfile(userId: string, endpointHost: string): WireGuardProfileResult {
  if (!wireGuardEnabled()) {
    return { enabled: false, available: false, reason: 'wireguard_disabled' };
  }

  if (!hasCommand('wg')) {
    return { enabled: true, available: false, reason: 'wg_command_missing' };
  }

  const interfaceName = wireGuardInterface();
  const confPath = wireGuardConfPath();

  if (!fs.existsSync(confPath)) {
    return { enabled: true, available: false, reason: `wireguard_conf_not_found:${confPath}` };
  }

  try {
    const profile = ensureUserProfile(userId);
    const serverPublicKey = getServerPublicKey(interfaceName);
    const endpointPort = currentListenPort(interfaceName);

    syncWireGuardPeers(interfaceName, confPath);
    appendPeerToConfIfMissing(confPath, profile);

    const ifaceUp = interfaceIsUp(interfaceName);
    let tunnelConnected = false;
    let lastHandshakeAt: number | null = null;
    if (ifaceUp) {
      applyPeerLive(interfaceName, profile);
      const latestHandshakeEpoch = getLatestHandshakeEpoch(interfaceName, profile.publicKey);
      if (latestHandshakeEpoch > 0) {
        lastHandshakeAt = latestHandshakeEpoch * 1000;
        const ageSeconds = Math.max(0, Math.floor(Date.now() / 1000) - latestHandshakeEpoch);
        const endpoint = getPeerEndpoint(interfaceName, profile.publicKey);
        // Keep this window short so UI quickly reflects disconnect events.
        tunnelConnected = ageSeconds <= 30 && endpoint !== '(none)' && endpoint !== '';
      }
    }

    const configText = buildClientConfig(profile, endpointHost, endpointPort, serverPublicKey);

    if (!ifaceUp) {
      // Config is ready and saved; interface just needs a reboot to come up
      return {
        enabled: true,
        available: false,
        reason: 'wireguard_interface_down',
        interfaceName,
        endpointHost,
        endpointPort,
        clientName: profile.clientName,
        clientIp: profile.clientIp,
        tunnelConnected: false,
        lastHandshakeAt: null,
        downloadPath: '/api/intercept/wireguard/config',
        configText,
      };
    }

    return {
      enabled: true,
      available: true,
      interfaceName,
      endpointHost,
      endpointPort,
      clientName: profile.clientName,
      clientIp: profile.clientIp,
      tunnelConnected,
      lastHandshakeAt,
      downloadPath: '/api/intercept/wireguard/config',
      configText,
    };
  } catch (error) {
    return {
      enabled: true,
      available: false,
      reason: error instanceof Error ? error.message : 'wireguard_profile_failed',
    };
  }
}
