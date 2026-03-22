// APIK Extension - Content Script
// Injects into every page to intercept XHR and fetch requests

(function () {
  'use strict';

  let allowedAuthOrigin = null;

  function updateAllowedAuthOrigin(appBaseUrl) {
    try {
      allowedAuthOrigin = appBaseUrl ? new URL(appBaseUrl).origin : null;
    } catch {
      allowedAuthOrigin = null;
    }
  }

  function syncInterceptState(enabled, apiBaseUrl, scopeId) {
    try {
      if (typeof scopeId === 'string' && scopeId) {
        localStorage.setItem('apik.ws.scopeId', scopeId);
      }
    } catch {
      // Ignore storage restrictions.
    }

    window.dispatchEvent(new CustomEvent('__apix_state__', {
      detail: {
        interceptEnabled: Boolean(enabled),
        apiBaseUrl: apiBaseUrl || null,
        scopeId: typeof scopeId === 'string' ? scopeId : null,
      },
    }));
  }

  // Inject a script into the page context so we can override XHR/fetch
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('injected.js');
  script.onload = async function () {
    this.remove();
    // Send initial state to injected.js after it is ready.
    try {
      const state = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });
      syncInterceptState(state?.interceptEnabled, state?.apiBaseUrl, state?.scopeId);
      updateAllowedAuthOrigin(state?.appBaseUrl);
    } catch {
      syncInterceptState(false, null, null);
      updateAllowedAuthOrigin(null);
    }
  };
  (document.head || document.documentElement).appendChild(script);

  // Listen for intercepted requests from injected.js
  window.addEventListener('__apix_intercept__', async (event) => {
    const detail = event.detail;
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'INTERCEPTED_FROM_PAGE',
        request: detail,
      });
      // Send back decision to injected.js
      window.dispatchEvent(new CustomEvent('__apix_decision__', {
        detail: { id: detail.id, decision: response },
      }));
    } catch (err) {
      // Extension not ready → auto-forward
      window.dispatchEvent(new CustomEvent('__apix_decision__', {
        detail: { id: detail.id, decision: { action: 'forward' } },
      }));
    }
  });

  // Listen for captured responses from injected.js
  window.addEventListener('__apix_response__', async (event) => {
    const detail = event.detail;
    try {
      await chrome.runtime.sendMessage({
        type: 'INTERCEPTED_RESPONSE_FROM_PAGE',
        response: detail,
      });
    } catch {
      // Ignore when background is unavailable
    }
  });

  // Receive auth token from APIK web app and forward it to background.
  window.addEventListener('message', async (event) => {
    if (event.source !== window) return;
    const data = event.data || {};
    if (data.source !== 'apik-web') return;

    const originMatched = !allowedAuthOrigin || event.origin === allowedAuthOrigin;

    if (data.type === 'APIK_AUTH_TOKEN') {
      try {
        await chrome.runtime.sendMessage({
          type: 'SET_AUTH_TOKEN',
          token: typeof data.token === 'string' && data.token ? data.token : null,
          origin: event.origin,
          originMatched,
        });
      } catch {
        // Ignore when extension background is not reachable.
      }
      return;
    }

    if (!originMatched) {
      return;
    }

    if (data.type === 'APIK_EXTENSION_PROXY_REQUEST') {
      const payload = data.payload || {};
      const requestId = typeof payload.requestId === 'string' ? payload.requestId : '';
      if (!requestId || !payload.request) return;

      try {
        const result = await chrome.runtime.sendMessage({
          type: 'PROXY_LOCAL_REQUEST',
          requestId,
          request: payload.request,
        });

        window.postMessage(
          {
            source: 'apik-extension',
            type: 'APIK_EXTENSION_PROXY_RESPONSE',
            payload: {
              requestId,
              ok: Boolean(result?.ok),
              response: result?.response,
              error: result?.error,
            },
          },
          event.origin,
        );
      } catch (error) {
        window.postMessage(
          {
            source: 'apik-extension',
            type: 'APIK_EXTENSION_PROXY_RESPONSE',
            payload: {
              requestId,
              ok: false,
              error: error instanceof Error ? error.message : 'Extension proxy unavailable',
            },
          },
          event.origin,
        );
      }
    }
  });

  // Keep injected.js in sync when intercept is toggled from popup/app.
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'STATUS_UPDATE') {
      syncInterceptState(msg.interceptEnabled, msg.apiBaseUrl, msg.scopeId);
      updateAllowedAuthOrigin(msg.appBaseUrl);
      return;
    }

    if (msg.type === 'REMOTE_DATA_CHANGED') {
      window.dispatchEvent(new CustomEvent('__apix_remote_data_changed__'));
    }
  });
})();
