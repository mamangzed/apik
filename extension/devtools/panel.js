const rowsEl = document.getElementById('rows');
const emptyEl = document.getElementById('empty');
const counterEl = document.getElementById('counter');
const connDotEl = document.getElementById('connDot');
const connTextEl = document.getElementById('connText');
const requestMetaEl = document.getElementById('requestMeta');
const responseMetaEl = document.getElementById('responseMeta');
const requestDetailEl = document.getElementById('requestDetail');
const responseDetailEl = document.getElementById('responseDetail');
const layoutEl = document.querySelector('.layout');
const detailsEl = document.querySelector('.details');
const horizontalSplitterEl = document.getElementById('horizontalSplitter');
const verticalSplitterEl = document.getElementById('verticalSplitter');
const contextMenuEl = document.getElementById('contextMenu');
const addToCollectionBtn = document.getElementById('addToCollectionBtn');

const searchInputEl = document.getElementById('searchInput');
const clearSearchBtnEl = document.getElementById('clearSearchBtn');
const clearRowsBtnEl = document.getElementById('clearRowsBtn');

const reqTabBodyEl = document.getElementById('reqTabBody');
const reqTabHeadersEl = document.getElementById('reqTabHeaders');
const reqTabCookiesEl = document.getElementById('reqTabCookies');
const reqCopyBtnEl = document.getElementById('reqCopyBtn');

const resTabBodyEl = document.getElementById('resTabBody');
const resTabHeadersEl = document.getElementById('resTabHeaders');
const resTabCookiesEl = document.getElementById('resTabCookies');
const resCopyBtnEl = document.getElementById('resCopyBtn');

const collectionModalBackdropEl = document.getElementById('collectionModalBackdrop');
const collectionSelectEl = document.getElementById('collectionSelect');
const requestNameInputEl = document.getElementById('requestNameInput');
const newCollectionInputEl = document.getElementById('newCollectionInput');
const cancelCollectionBtnEl = document.getElementById('cancelCollectionBtn');
const confirmCollectionBtnEl = document.getElementById('confirmCollectionBtn');

const entries = [];
const maxEntries = 400;
let selectedId = null;
let contextTargetId = null;
let requestTab = 'body';
let responseTab = 'body';
let pendingCollectionTargetId = null;
let pendingCollectionListRequestId = null;

const port = chrome.runtime.connect({ name: 'apix-devtools' });

port.onMessage.addListener((msg) => {
  if (msg.type === 'DEVTOOLS_STATUS') {
    const on = msg.connected === true;
    connDotEl.classList.toggle('on', on);
    connTextEl.textContent = on ? 'Connected' : 'Disconnected';
    return;
  }

  if (msg.type === 'DEVTOOLS_INTERCEPTED') {
    upsertIntercept(msg.request);
    return;
  }

  if (msg.type === 'DEVTOOLS_REQUEST_HEADERS_UPDATE') {
    const idx = entries.findIndex((e) => e.id === msg.id);
    if (idx !== -1) {
      entries[idx].headers = {
        ...(entries[idx].headers || {}),
        ...(msg.headers || {}),
      };
      render();
    }
    return;
  }

  if (msg.type === 'DEVTOOLS_REQUEST_UPDATE') {
    const idx = entries.findIndex((e) => e.id === msg.id);
    if (idx !== -1) {
      entries[idx].status = msg.status;
      render();
    }
    return;
  }

  if (msg.type === 'DEVTOOLS_RESPONSE_UPDATE') {
    const idx = entries.findIndex((e) => e.id === msg.id);
    if (idx !== -1) {
      entries[idx].response = {
        ...(entries[idx].response || {}),
        ...(msg.response || {}),
      };
      if (!entries[idx].status || entries[idx].status === 'pending') {
        entries[idx].status = 'completed';
      }
      render();
    }
    return;
  }

  if (msg.type === 'DEVTOOLS_COLLECTIONS_RESULT') {
    if (msg.requestId !== pendingCollectionListRequestId) return;
    pendingCollectionListRequestId = null;
    showCollectionOptions(Array.isArray(msg.collections) ? msg.collections : []);
    return;
  }

  if (msg.type === 'DEVTOOLS_ADD_RESULT') {
    const selected = entries.find((e) => e.id === msg.id) || entries.find((e) => e.id === pendingCollectionTargetId);
    if (selected) {
      selected.status = msg.ok ? 'added-to-collection' : `add-failed: ${msg.error || 'unknown'}`;
      render();
    }
  }
});

port.onDisconnect.addListener(() => {
  connDotEl.classList.remove('on');
  connTextEl.textContent = 'Disconnected';
});

function upsertIntercept(request) {
  const existing = entries.find((e) => e.id === request.id);
  if (existing) {
    Object.assign(existing, request);
  } else {
    entries.unshift(request);
    if (entries.length > maxEntries) entries.pop();
  }

  if (!selectedId) selectedId = request.id;
  render();
}

function getFilteredEntries() {
  const query = (searchInputEl.value || '').trim().toLowerCase();
  if (!query) return entries;

  return entries.filter((entry) => buildSearchBlob(entry).includes(query));
}

function buildSearchBlob(entry) {
  const requestHeaders = JSON.stringify(entry.headers || {});
  const responseHeaders = JSON.stringify(entry.response?.headers || {});
  const requestBody = String(entry.body || '');
  const responseBody = String(entry.response?.body || '');
  const requestCookies = extractRequestCookies(entry.headers || {}).join('\n');
  const responseCookies = extractResponseCookies(entry.response?.headers || {}).join('\n');

  return [
    entry.id,
    entry.method,
    entry.url,
    entry.source,
    entry.status,
    requestHeaders,
    responseHeaders,
    requestBody,
    responseBody,
    requestCookies,
    responseCookies,
  ].join('\n').toLowerCase();
}

function render() {
  const filtered = getFilteredEntries();
  rowsEl.innerHTML = '';
  counterEl.textContent = `${filtered.length} / ${entries.length} requests`;
  emptyEl.style.display = filtered.length === 0 ? 'block' : 'none';

  for (const item of filtered) {
    const tr = document.createElement('tr');
    if (item.id === selectedId) tr.classList.add('selected');

    const method = (item.method || 'GET').toUpperCase();
    const cls = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)
      ? `m-${method.toLowerCase()}`
      : 'm-other';

    const url = item.url || '';
    let host = '';
    try {
      host = new URL(url).host;
    } catch {
      host = '';
    }

    const status = item.status || 'pending';
    const source = item.source || 'unknown';
    const reqBody = formatBodyPreview(item.body);
    const resBody = formatBodyPreview(item.response?.body || '');
    const responseStatus = item.response?.status ? `${item.response.status}` : '';

    tr.innerHTML = `
      <td><span class="method ${cls}">${escapeHtml(method)}</span></td>
      <td>
        <div class="url">${escapeHtml(url)}</div>
        <div class="host">${escapeHtml(host)}</div>
      </td>
      <td class="meta">${escapeHtml(source)}</td>
      <td class="meta">${escapeHtml(status)}${responseStatus ? ` · ${escapeHtml(responseStatus)}` : ''}</td>
      <td><div class="body req-preview"></div></td>
      <td><div class="body res-preview"></div></td>
    `;

    const reqPreviewEl = tr.querySelector('.req-preview');
    const resPreviewEl = tr.querySelector('.res-preview');
    renderPreviewContent(reqPreviewEl, reqBody);
    renderPreviewContent(resPreviewEl, resBody || '(no response preview)');

    tr.addEventListener('click', () => {
      selectedId = item.id;
      hideContextMenu();
      render();
    });

    tr.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      selectedId = item.id;
      contextTargetId = item.id;
      render();
      showContextMenu(event.clientX, event.clientY);
    });

    rowsEl.appendChild(tr);
  }

  renderDetails();
  renderTabs();
}

function renderTabs() {
  setActiveTab(reqTabBodyEl, requestTab === 'body');
  reqTabHeadersEl.textContent = `Headers${selectedId ? ` (${Object.keys((entries.find((entry) => entry.id === selectedId)?.headers) || {}).length})` : ''}`;
  reqTabCookiesEl.textContent = `Cookies${selectedId ? ` (${extractRequestCookies(entries.find((entry) => entry.id === selectedId)?.headers || {}).length})` : ''}`;
  setActiveTab(reqTabHeadersEl, requestTab === 'headers');
  setActiveTab(reqTabCookiesEl, requestTab === 'cookies');

  setActiveTab(resTabBodyEl, responseTab === 'body');
  const selected = entries.find((entry) => entry.id === selectedId);
  const responseHeaders = selected?.response?.headers || {};
  resTabHeadersEl.textContent = `Headers${selected ? ` (${Object.keys(responseHeaders).length})` : ''}`;
  resTabCookiesEl.textContent = `Cookies${selected ? ` (${extractResponseCookies(responseHeaders).length})` : ''}`;
  setActiveTab(resTabHeadersEl, responseTab === 'headers');
  setActiveTab(resTabCookiesEl, responseTab === 'cookies');
}

function setActiveTab(el, active) {
  if (active) el.classList.add('active');
  else el.classList.remove('active');
}

function renderDetails() {
  const selected = entries.find((entry) => entry.id === selectedId);
  if (!selected) {
    requestMetaEl.innerHTML = 'Select a request from the table.';
    responseMetaEl.innerHTML = 'Response preview will appear here.';
    requestDetailEl.innerHTML = '<div class="empty-state">Select a request from the table.</div>';
    responseDetailEl.innerHTML = '<div class="empty-state">Response preview will appear here.</div>';
    return;
  }

  requestMetaEl.innerHTML = buildRequestMeta(selected);
  responseMetaEl.innerHTML = buildResponseMeta(selected);

  renderRequestDetail(selected);
  renderResponseDetail(selected);
}

function buildRequestMeta(entry) {
  const method = escapeHtml((entry.method || 'GET').toUpperCase());
  const url = escapeHtml(entry.url || '');
  const source = escapeHtml(entry.source || 'unknown');
  const host = safeHost(entry.url);
  const headerCount = Object.keys(entry.headers || {}).length;
  const size = estimateSize(entry.body);
  return `<strong>${method}</strong><span>${host ? escapeHtml(host) : url}</span><span>Source: ${source}</span><span>Headers: ${headerCount}</span><span>Body: ${formatBytes(size)}</span>`;
}

function buildResponseMeta(entry) {
  const response = entry.response || {};
  if (!response.status) {
    return '<span>No response received yet.</span>';
  }

  const statusCode = Number(response.status || 0);
  const statusClass = statusCode >= 200 && statusCode < 300
    ? 'ok'
    : statusCode >= 300 && statusCode < 400
      ? 'redirect'
      : 'error';

  const elapsed = typeof response.timestamp === 'number' && typeof entry.timestamp === 'number'
    ? Math.max(0, response.timestamp - entry.timestamp)
    : 0;
  const size = estimateSize(response.body);
  return `<span class="status-code ${statusClass}">${escapeHtml(statusCode)}</span><span>${escapeHtml(response.statusText || '')}</span><span>${formatMs(elapsed)}</span><span>${formatBytes(size)}</span>`;
}

function renderRequestDetail(entry) {
  if (requestTab === 'headers') {
    requestDetailEl.innerHTML = renderHeadersTable(entry.headers || {}, 'No request headers');
    return;
  }

  if (requestTab === 'cookies') {
    requestDetailEl.innerHTML = renderCookies(extractRequestCookies(entry.headers || {}), 'No request cookies');
    return;
  }

  requestDetailEl.innerHTML = renderBodyContent(formatValue(entry.body, '(no request body)'));
}

function renderResponseDetail(entry) {
  const response = entry.response || {};
  if (responseTab === 'headers') {
    responseDetailEl.innerHTML = renderHeadersTable(response.headers || {}, 'No response headers');
    return;
  }

  if (responseTab === 'cookies') {
    responseDetailEl.innerHTML = renderCookies(extractResponseCookies(response.headers || {}), 'No response cookies');
    return;
  }

  responseDetailEl.innerHTML = renderBodyContent(formatValue(response.body, '(no response body)'));
}

function renderHeadersTable(headers, emptyText) {
  const entriesList = Object.entries(headers || {});
  if (entriesList.length === 0) {
    return `<div class="empty-state">${escapeHtml(emptyText)}</div>`;
  }

  return `
    <div class="kv-list">
      <div class="kv-head">
        <div>Header</div>
        <div>Value</div>
      </div>
      ${entriesList.map(([key, value]) => `
        <div class="kv-row">
          <div class="kv-key">${escapeHtml(key)}</div>
          <div class="kv-value">${escapeHtml(String(value))}</div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderCookies(cookies, emptyText) {
  if (!cookies || cookies.length === 0) {
    return `<div class="empty-state">${escapeHtml(emptyText)}</div>`;
  }

  return `
    <div class="cookie-list">
      ${cookies.map((cookie) => `<div class="cookie-card">${escapeHtml(cookie)}</div>`).join('')}
    </div>
  `;
}

function renderBodyContent(text) {
  return `<pre class="code-view">${colorizeJsonIfPossible(text, false)}</pre>`;
}

function formatRequestDetail(entry) {
  if (requestTab === 'headers') {
    return formatObject(entry.headers || {});
  }

  if (requestTab === 'cookies') {
    const cookies = extractRequestCookies(entry.headers || {});
    return cookies.length > 0 ? cookies.join('\n\n') : '(no request cookies)';
  }

  return formatValue(entry.body, '(no request body)');
}

function formatResponseDetail(entry) {
  const response = entry.response || {};
  if (responseTab === 'headers') {
    return formatObject(response.headers || {});
  }

  if (responseTab === 'cookies') {
    const cookies = extractResponseCookies(response.headers || {});
    return cookies.length > 0 ? cookies.join('\n\n') : '(no response cookies)';
  }

  const bodyText = formatValue(response.body, '(no response body)');
  const statusText = response.status
    ? `Status: ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`
    : 'Status: (unknown)';
  return `${statusText}\n\n${bodyText}`;
}

function safeHost(url) {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

function estimateSize(value) {
  if (value == null) return 0;
  try {
    return new TextEncoder().encode(String(value)).length;
  } catch {
    return String(value).length;
  }
}

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatMs(ms) {
  if (!ms || ms <= 0) return '0 ms';
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function formatObject(value) {
  try {
    return JSON.stringify(value || {}, null, 2);
  } catch {
    return String(value || '{}');
  }
}

function formatValue(value, fallback) {
  if (value == null || value === '') return fallback;
  const text = String(value);
  try {
    const parsed = JSON.parse(text);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return text;
  }
}

function extractRequestCookies(headers) {
  const out = [];
  for (const [key, value] of Object.entries(headers || {})) {
    if (key.toLowerCase() === 'cookie') {
      out.push(String(value));
    }
  }
  return out;
}

function extractResponseCookies(headers) {
  const out = [];
  for (const [key, value] of Object.entries(headers || {})) {
    if (key.toLowerCase() === 'set-cookie') {
      if (Array.isArray(value)) {
        value.forEach((item) => out.push(String(item)));
      } else {
        out.push(String(value));
      }
    }
  }
  return out;
}

function formatBodyPreview(body) {
  if (body == null || body === '') return '(no body)';
  const text = String(body);

  try {
    const parsed = JSON.parse(text);
    const pretty = JSON.stringify(parsed, null, 2);
    return pretty.length > 800 ? `${pretty.slice(0, 800)}...` : pretty;
  } catch {
    return text.length > 800 ? `${text.slice(0, 800)}...` : text;
  }
}

function showContextMenu(x, y) {
  contextMenuEl.style.left = `${x}px`;
  contextMenuEl.style.top = `${y}px`;
  contextMenuEl.style.display = 'block';
}

function hideContextMenu() {
  contextMenuEl.style.display = 'none';
}

function openCollectionModal() {
  pendingCollectionTargetId = contextTargetId || selectedId;
  if (!pendingCollectionTargetId) return;

  const selected = entries.find((entry) => entry.id === pendingCollectionTargetId);
  const fallbackName = selected
    ? `${selected.method || 'GET'} ${selected.url || ''}`.slice(0, 120)
    : '';

  newCollectionInputEl.value = '';
  requestNameInputEl.value = fallbackName;
  collectionSelectEl.innerHTML = '<option>Loading collections...</option>';
  collectionModalBackdropEl.style.display = 'flex';

  const requestId = `list_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  pendingCollectionListRequestId = requestId;
  port.postMessage({ type: 'DEVTOOLS_LIST_COLLECTIONS', requestId });
}

function closeCollectionModal() {
  collectionModalBackdropEl.style.display = 'none';
  pendingCollectionTargetId = null;
}

function showCollectionOptions(collections) {
  collectionSelectEl.innerHTML = '';
  collections.forEach((collection) => {
    const opt = document.createElement('option');
    opt.value = collection.id;
    opt.textContent = collection.name;
    collectionSelectEl.appendChild(opt);
  });

  if (collections.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '(No collection yet)';
    collectionSelectEl.appendChild(opt);
  }
}

function confirmAddToCollection() {
  const selected = entries.find((entry) => entry.id === pendingCollectionTargetId);
  if (!selected) {
    closeCollectionModal();
    return;
  }

  const collectionId = collectionSelectEl.value || undefined;
  const newCollectionName = (newCollectionInputEl.value || '').trim() || undefined;
  const requestName = (requestNameInputEl.value || '').trim() || undefined;

  port.postMessage({
    type: 'DEVTOOLS_ADD_TO_COLLECTION',
    id: selected.id,
    request: selected,
    collectionId,
    newCollectionName,
    requestName,
  });

  selected.status = 'adding-to-collection';
  closeCollectionModal();
  render();
}

addToCollectionBtn.addEventListener('click', () => {
  hideContextMenu();
  openCollectionModal();
});

searchInputEl.addEventListener('input', render);
clearSearchBtnEl.addEventListener('click', () => {
  searchInputEl.value = '';
  render();
});

clearRowsBtnEl.addEventListener('click', () => {
  entries.splice(0, entries.length);
  selectedId = null;
  contextTargetId = null;
  render();
  port.postMessage({ type: 'DEVTOOLS_CLEAR_INTERCEPTS' });
});

reqTabBodyEl.addEventListener('click', () => { requestTab = 'body'; render(); });
reqTabHeadersEl.addEventListener('click', () => { requestTab = 'headers'; render(); });
reqTabCookiesEl.addEventListener('click', () => { requestTab = 'cookies'; render(); });

resTabBodyEl.addEventListener('click', () => { responseTab = 'body'; render(); });
resTabHeadersEl.addEventListener('click', () => { responseTab = 'headers'; render(); });
resTabCookiesEl.addEventListener('click', () => { responseTab = 'cookies'; render(); });

reqCopyBtnEl.addEventListener('click', async () => {
  const selected = entries.find((entry) => entry.id === selectedId);
  if (!selected) return;

  const value = requestTab === 'headers'
    ? formatObject(selected.headers || {})
    : requestTab === 'cookies'
      ? extractRequestCookies(selected.headers || {}).join('\n\n') || '(no request cookies)'
      : formatValue(selected.body, '(no request body)');

  await navigator.clipboard.writeText(value);
});

resCopyBtnEl.addEventListener('click', async () => {
  const selected = entries.find((entry) => entry.id === selectedId);
  if (!selected) return;

  const response = selected.response || {};
  const value = responseTab === 'headers'
    ? formatObject(response.headers || {})
    : responseTab === 'cookies'
      ? extractResponseCookies(response.headers || {}).join('\n\n') || '(no response cookies)'
      : formatValue(response.body, '(no response body)');

  await navigator.clipboard.writeText(value);
});

cancelCollectionBtnEl.addEventListener('click', closeCollectionModal);
confirmCollectionBtnEl.addEventListener('click', confirmAddToCollection);
collectionModalBackdropEl.addEventListener('click', (event) => {
  if (event.target === collectionModalBackdropEl) closeCollectionModal();
});

window.addEventListener('click', hideContextMenu);
window.addEventListener('blur', hideContextMenu);

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function renderPreviewContent(target, text) {
  if (!target) return;
  const colored = colorizeJsonIfPossible(text, true);
  target.innerHTML = `<pre>${colored}</pre>`;
}

function renderCodeContent(target, text) {
  const colored = colorizeJsonIfPossible(text, false);
  target.innerHTML = colored;
}

function colorizeJsonIfPossible(rawText, compact) {
  const text = String(rawText ?? '');
  const normalized = compact ? text : text.trim();

  try {
    const parsed = JSON.parse(normalized);
    const json = JSON.stringify(parsed, null, compact ? 1 : 2);
    return highlightJson(json);
  } catch {
    return escapeHtml(text);
  }
}

function highlightJson(json) {
  const escaped = escapeHtml(json);
  return escaped.replace(
    /(\"(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\\"])*\"\s*:?)|(\btrue\b|\bfalse\b)|(\bnull\b)|(-?\d+(?:\.\d+)?(?:[eE][+\-]?\d+)?)|([{}\[\],:])/g,
    (match, stringToken, _esc, boolToken, nullToken, numberToken, puncToken) => {
      if (stringToken) {
        return stringToken.endsWith(':')
          ? `<span class="token-key">${stringToken}</span>`
          : `<span class="token-string">${stringToken}</span>`;
      }
      if (boolToken) return `<span class="token-boolean">${boolToken}</span>`;
      if (nullToken) return `<span class="token-null">${nullToken}</span>`;
      if (numberToken) return `<span class="token-number">${numberToken}</span>`;
      if (puncToken) return `<span class="token-punc">${puncToken}</span>`;
      return match;
    }
  );
}

function initSplitters() {
  if (!layoutEl || !detailsEl || !horizontalSplitterEl || !verticalSplitterEl) return;

  let active = null;

  const onMove = (event) => {
    if (!active) return;

    if (active === 'horizontal') {
      const rect = layoutEl.getBoundingClientRect();
      const topPx = Math.min(Math.max(event.clientY - rect.top, 140), rect.height - 180);
      const topPct = (topPx / rect.height) * 100;
      layoutEl.style.setProperty('--top-size', `${topPct}%`);
    }

    if (active === 'vertical') {
      const rect = detailsEl.getBoundingClientRect();
      const leftPx = Math.min(Math.max(event.clientX - rect.left, 220), rect.width - 230);
      const leftPct = (leftPx / rect.width) * 100;
      detailsEl.style.setProperty('--left-size', `${leftPct}%`);
    }
  };

  const onUp = () => {
    active = null;
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
  };

  horizontalSplitterEl.addEventListener('mousedown', (event) => {
    event.preventDefault();
    active = 'horizontal';
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'row-resize';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });

  verticalSplitterEl.addEventListener('mousedown', (event) => {
    event.preventDefault();
    active = 'vertical';
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });
}

port.postMessage({ type: 'DEVTOOLS_INIT' });
initSplitters();
render();
