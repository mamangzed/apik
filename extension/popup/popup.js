// APIK Extension Popup Script

const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const wsUrlInput = document.getElementById('ws-url');
const apiBaseUrlInput = document.getElementById('api-base-url');
const appBaseUrlInput = document.getElementById('app-base-url');
const connectBtn = document.getElementById('connect-btn');
const interceptToggle = document.getElementById('intercept-toggle');
const interceptBadge = document.getElementById('intercept-badge');
const openApikBtn = document.getElementById('open-apik');
const openSettingsBtn = document.getElementById('open-settings');

const statusMap = {
  connected: { text: 'Connected', dotClass: 'connected' },
  connecting: { text: 'Connecting…', dotClass: 'connecting' },
  disconnected: { text: 'Disconnected', dotClass: 'disconnected' },
  error: { text: 'Connection Error', dotClass: 'error' },
  auth_required: { text: 'Login required in APIK', dotClass: 'error' },
};

function normalizeWsUrl(raw, apiBaseUrl) {
  const fallback = `${apiBaseUrl.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:').replace(/\/+$/, '')}/ws/intercept`;
  const value = String(raw || '').trim();
  if (!value) return fallback;

  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
      parsed.protocol = parsed.protocol === 'http:' ? 'ws:' : 'wss:';
    }
    if (parsed.pathname === '/' || !parsed.pathname.startsWith('/ws/intercept')) {
      parsed.pathname = '/ws/intercept';
    }
    return parsed.toString();
  } catch {
    return fallback;
  }
}

// ── Load current state ────────────────────────────────────────────────────────

async function loadState() {
  try {
    const state = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });
    updateUI(state);

    const stored = await chrome.storage.local.get(['wsUrl', 'apiBaseUrl', 'appBaseUrl']);
    wsUrlInput.value = stored.wsUrl || state.wsUrl || '';
    apiBaseUrlInput.value = stored.apiBaseUrl || state.apiBaseUrl || 'https://apik.app';
    appBaseUrlInput.value = stored.appBaseUrl || state.appBaseUrl || 'https://apik.app';
  } catch (err) {
    updateUI({ connected: false, status: 'disconnected', interceptEnabled: false });
  }
}

function updateUI(state) {
  const status = state.status || (state.connected ? 'connected' : 'disconnected');
  const info = statusMap[status] || statusMap.disconnected;

  // Connection status
  statusDot.className = 'status-dot ' + info.dotClass;
  statusText.textContent = state.detail ? `${info.text} (${state.detail})` : info.text;

  // Intercept toggle
  interceptToggle.checked = state.interceptEnabled || false;
  if (state.interceptEnabled) {
    interceptBadge.className = 'intercept-badge on';
    interceptBadge.textContent = '● Intercepting';
  } else {
    interceptBadge.className = 'intercept-badge off';
    interceptBadge.textContent = '● Off';
  }

  // Button state
  connectBtn.textContent = state.status === 'connecting' ? 'Connecting…' : 'Connect';
  connectBtn.disabled = state.status === 'connecting';
}

// ── Event Listeners ──────────────────────────────────────────────────────────

connectBtn.addEventListener('click', async () => {
  const apiBaseUrl = apiBaseUrlInput.value.trim() || 'https://apik.app';
  const appBaseUrl = appBaseUrlInput.value.trim() || 'https://apik.app';
  const wsUrl = normalizeWsUrl(wsUrlInput.value.trim(), apiBaseUrl);
  wsUrlInput.value = wsUrl;

  connectBtn.textContent = 'Connecting…';
  connectBtn.disabled = true;
  try {
    await chrome.runtime.sendMessage({
      type: 'SET_BASE_URLS',
      apiBaseUrl,
      appBaseUrl,
      wsUrl,
    });
    setTimeout(loadState, 1000);
  } catch {
    connectBtn.textContent = 'Connect';
    connectBtn.disabled = false;
  }
});

interceptToggle.addEventListener('change', async () => {
  const enabled = interceptToggle.checked;
  try {
    await chrome.runtime.sendMessage({ type: 'SET_INTERCEPT', enabled });
    if (enabled) {
      interceptBadge.className = 'intercept-badge on';
      interceptBadge.textContent = '● Intercepting';
    } else {
      interceptBadge.className = 'intercept-badge off';
      interceptBadge.textContent = '● Off';
    }
  } catch {
    interceptToggle.checked = !enabled; // revert
  }
});

openApikBtn.addEventListener('click', () => {
  const appBaseUrl = appBaseUrlInput.value.trim() || 'https://apik.app';
  chrome.tabs.create({ url: appBaseUrl });
});

openSettingsBtn.addEventListener('click', () => {
  const appBaseUrl = appBaseUrlInput.value.trim() || 'https://apik.app';
  chrome.tabs.create({ url: appBaseUrl });
});

// ── Listen for status updates from background ─────────────────────────────────

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'STATUS_UPDATE') {
    updateUI(msg);
  }
});

// ── Init ──────────────────────────────────────────────────────────────────────

loadState();
