// APIK Extension - Injected Script (runs in page context)
// Overrides window.fetch and XMLHttpRequest to intercept requests

(function () {
  'use strict';

  let interceptEnabled = false;
  let backendOrigin = '';
  let pendingCallbacks = new Map(); // id -> { resolve }

  // Listen for decisions from content.js
  window.addEventListener('__apix_decision__', (event) => {
    const { id, decision } = event.detail;
    const cb = pendingCallbacks.get(id);
    if (cb) {
      pendingCallbacks.delete(id);
      cb(decision);
    }
  });

  // Check intercept state from page
  window.addEventListener('__apix_state__', (event) => {
    interceptEnabled = event.detail.interceptEnabled;
    try {
      backendOrigin = event.detail?.apiBaseUrl ? new URL(event.detail.apiBaseUrl).origin : '';
    } catch {
      backendOrigin = '';
    }
  });

  function isBackendRequest(url) {
    if (!backendOrigin) return false;
    try {
      return new URL(url, window.location.href).origin === backendOrigin;
    } catch {
      return false;
    }
  }

  function generateId() {
    return 'page_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  }

  function isLikelyText(contentType) {
    if (!contentType) return true;
    const ct = contentType.toLowerCase();
    return (
      ct.includes('json') ||
      ct.includes('xml') ||
      ct.includes('text') ||
      ct.includes('javascript') ||
      ct.includes('graphql') ||
      ct.includes('x-www-form-urlencoded')
    );
  }

  function bytesToBase64(bytes) {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      const sub = bytes.subarray(i, i + chunk);
      binary += String.fromCharCode(...sub);
    }
    return btoa(binary);
  }

  function decodeBytes(bytes, contentType) {
    try {
      if (isLikelyText(contentType)) {
        return new TextDecoder('utf-8').decode(bytes);
      }
    } catch {}

    const base64 = bytesToBase64(bytes);
    return `[binary:${contentType || 'unknown'};base64] ${base64.slice(0, 1200)}${base64.length > 1200 ? '...' : ''}`;
  }

  async function serializeBody(body, contentType = '') {
    if (body == null) return null;
    if (typeof body === 'string') return body;
    if (body instanceof URLSearchParams) return body.toString();

    if (typeof FormData !== 'undefined' && body instanceof FormData) {
      const out = {};
      for (const [key, value] of body.entries()) {
        if (typeof value === 'string') {
          out[key] = value;
        } else {
          out[key] = {
            type: 'file',
            name: value.name,
            size: value.size,
            mime: value.type,
          };
        }
      }
      return JSON.stringify(out, null, 2);
    }

    if (typeof Blob !== 'undefined' && body instanceof Blob) {
      const bytes = new Uint8Array(await body.arrayBuffer());
      return decodeBytes(bytes, body.type || contentType);
    }

    if (body instanceof ArrayBuffer) {
      return decodeBytes(new Uint8Array(body), contentType);
    }

    if (ArrayBuffer.isView(body)) {
      return decodeBytes(new Uint8Array(body.buffer, body.byteOffset, body.byteLength), contentType);
    }

    if (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream) {
      return '[stream body: not serializable in page interceptor]';
    }

    try {
      return JSON.stringify(body, null, 2);
    } catch {
      return String(body);
    }
  }

  async function extractFetchBody(input, init) {
    const contentTypeFromInit = (() => {
      try {
        if (!init?.headers) return '';
        const h = new Headers(init.headers);
        return h.get('content-type') || '';
      } catch {
        return '';
      }
    })();

    if (init?.body !== undefined) {
      return serializeBody(init.body, contentTypeFromInit);
    }

    if (input instanceof Request) {
      try {
        const clone = input.clone();
        const ct = clone.headers.get('content-type') || contentTypeFromInit;
        if (!clone.body) return null;

        if (isLikelyText(ct)) {
          return await clone.text();
        }

        const buffer = await clone.arrayBuffer();
        return decodeBytes(new Uint8Array(buffer), ct);
      } catch {
        return null;
      }
    }

    return null;
  }

  function sendIntercepted(request) {
    return new Promise((resolve) => {
      if (!interceptEnabled) {
        resolve({ action: 'forward' });
        return;
      }
      pendingCallbacks.set(request.id, resolve);
      window.dispatchEvent(new CustomEvent('__apix_intercept__', { detail: request }));
      // Fallback timeout (30s)
      setTimeout(() => {
        if (pendingCallbacks.has(request.id)) {
          pendingCallbacks.delete(request.id);
          resolve({ action: 'forward' });
        }
      }, 30000);
    });
  }

  function dispatchResponse(payload) {
    window.dispatchEvent(new CustomEvent('__apix_response__', { detail: payload }));
  }

  function headersToObject(headers) {
    const out = {};
    if (!headers) return out;
    headers.forEach((value, key) => {
      out[key] = value;
    });
    return out;
  }

  // ─── Override fetch ───────────────────────────────────────────────────────────
  const originalFetch = window.fetch.bind(window);

  window.fetch = async function (input, init = {}) {
    if (!interceptEnabled) return originalFetch(input, init);

    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = (init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();

    // Don't intercept APIK backend
    if (isBackendRequest(url)) return originalFetch(input, init);

    const body = await extractFetchBody(input, init);

    const headers = {};
    if (input instanceof Request) {
      input.headers.forEach((v, k) => { headers[k] = v; });
    }
    if (init.headers) {
      const h = new Headers(init.headers);
      h.forEach((v, k) => { headers[k] = v; });
    }

    const id = generateId();
    const decision = await sendIntercepted({ id, method, url, headers, body, timestamp: Date.now() });

    if (decision.action === 'drop') {
      // Return an empty 200 for dropped requests to prevent page errors
      return new Response(null, { status: 204, statusText: 'Dropped by APIK' });
    }

    // Use modified request if provided
    const modified = decision.modified;
    if (modified) {
      const response = await originalFetch(modified.url || url, {
        ...init,
        method: modified.method || method,
        headers: modified.headers || init.headers,
        body: modified.body ?? init.body,
      });

      try {
        const clone = response.clone();
        const contentType = clone.headers.get('content-type') || '';
        let responseBody = '';
        if (isLikelyText(contentType)) {
          responseBody = await clone.text();
        } else {
          const buffer = await clone.arrayBuffer();
          responseBody = decodeBytes(new Uint8Array(buffer), contentType);
        }
        dispatchResponse({
          id,
          status: response.status,
          statusText: response.statusText,
          headers: headersToObject(clone.headers),
          body: responseBody,
          timestamp: Date.now(),
          source: 'injected',
        });
      } catch {
        // Ignore response preview failures
      }

      return response;
    }

    const response = await originalFetch(input, init);
    try {
      const clone = response.clone();
      const contentType = clone.headers.get('content-type') || '';
      let responseBody = '';
      if (isLikelyText(contentType)) {
        responseBody = await clone.text();
      } else {
        const buffer = await clone.arrayBuffer();
        responseBody = decodeBytes(new Uint8Array(buffer), contentType);
      }
      dispatchResponse({
        id,
        status: response.status,
        statusText: response.statusText,
        headers: headersToObject(clone.headers),
        body: responseBody,
        timestamp: Date.now(),
        source: 'injected',
      });
    } catch {
      // Ignore response preview failures
    }

    return response;
  };

  // ─── Override XHR ─────────────────────────────────────────────────────────────
  const OriginalXHR = window.XMLHttpRequest;

  window.XMLHttpRequest = function () {
    const xhr = new OriginalXHR();
    let _method = 'GET';
    let _url = '';
    let _headers = {};
    let _interceptId = '';

    const originalOpen = xhr.open.bind(xhr);
    const originalSend = xhr.send.bind(xhr);
    const originalSetRequestHeader = xhr.setRequestHeader.bind(xhr);

    xhr.setRequestHeader = function (name, value) {
      _headers[name] = value;
      originalSetRequestHeader(name, value);
    };

    xhr.open = function (method, url, ...args) {
      _method = method.toUpperCase();
      _url = typeof url === 'string' ? url : String(url);
      return originalOpen(method, url, ...args);
    };

    xhr.send = async function (body) {
      if (!interceptEnabled || isBackendRequest(_url)) {
        return originalSend(body);
      }

      const bodyStr = await serializeBody(body, _headers['Content-Type'] || _headers['content-type'] || '');

      const id = generateId();
      _interceptId = id;
      const decision = await sendIntercepted({
        id,
        method: _method,
        url: _url,
        headers: { ..._headers },
        body: bodyStr,
        timestamp: Date.now(),
      });

      if (decision.action === 'drop') {
        // Trigger a mocked abort
        Object.defineProperty(xhr, 'status', { get: () => 0 });
        if (xhr.onerror) xhr.onerror(new ProgressEvent('error'));
        return;
      }

      if (decision.modified) {
        // Can't easily modify XHR mid-flight, just forward
      }

      xhr.addEventListener('loadend', () => {
        try {
          const contentType = xhr.getResponseHeader('content-type') || '';
          let responseBody = '';

          if (xhr.responseType === '' || xhr.responseType === 'text') {
            responseBody = xhr.responseText || '';
          } else if (xhr.responseType === 'arraybuffer' && xhr.response) {
            responseBody = decodeBytes(new Uint8Array(xhr.response), contentType);
          } else if (xhr.responseType === 'blob' && xhr.response) {
            // Blob response from XHR cannot be read sync here reliably; provide metadata.
            responseBody = `[blob response] type=${xhr.response.type || contentType || 'unknown'} size=${xhr.response.size || 0}`;
          } else {
            responseBody = String(xhr.response || '');
          }

          dispatchResponse({
            id: _interceptId || id,
            status: xhr.status,
            statusText: xhr.statusText,
            headers: parseRawHeaders(xhr.getAllResponseHeaders()),
            body: responseBody,
            timestamp: Date.now(),
            source: 'injected',
          });
        } catch {
          // Ignore response preview failures
        }
      }, { once: true });

      return originalSend(body);
    };

    return xhr;
  };

  // Copy static properties
  Object.setPrototypeOf(window.XMLHttpRequest, OriginalXHR);
  Object.setPrototypeOf(window.XMLHttpRequest.prototype, OriginalXHR.prototype);

  function parseRawHeaders(raw) {
    const out = {};
    if (!raw) return out;
    const lines = raw.trim().split(/\r?\n/);
    lines.forEach((line) => {
      const index = line.indexOf(':');
      if (index <= 0) return;
      const key = line.slice(0, index).trim();
      const value = line.slice(index + 1).trim();
      out[key] = value;
    });
    return out;
  }

  console.log('[APIK] Request interceptor injected');
})();
