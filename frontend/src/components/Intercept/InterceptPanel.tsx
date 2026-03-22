import { useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import Editor from '@monaco-editor/react';
import toast from 'react-hot-toast';
import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels';
import {
  Shield,
  ShieldCheck,
  CheckCircle,
  XCircle,
  Trash2,
  Wand2,
  Wifi,
  User,
  Filter,
  Smartphone,
  Copy,
  ExternalLink,
  Activity,
  RefreshCw,
  Zap,
  Search,
  X as XIcon,
} from 'lucide-react';
import { useAppStore } from '../../store';
import { HttpMethod, InterceptedRequest } from '../../types';
import { METHOD_BG_COLORS, beautifyContent, canBeautifyContent, detectLanguage } from '../../utils/format';
import { getWsInterceptUrl } from '../../lib/runtimeConfig';
import { apiClient } from '../../lib/apiClient';

interface ProxySetupInfo {
  host: string;
  recommendedProxyHost?: string;
  recommendedProxyPort?: number;
  recommendedProxySource?: 'wireguard' | 'public';
  hostSource?: 'env' | 'request';
  port: number;
  portMode?: 'single' | 'range';
  portRange?: string;
  portPool?: {
    mode: 'single' | 'range';
    range: string;
    totalPorts: number;
    assignedPorts: number;
    availablePorts: number;
  };
  proxyUrl: string;
  portExpiresAt?: string | null;
  tokenExpiresAt: number;
  caDownloadUrl: string | null;
  caCommonName: string;
  caReady: boolean;
  notes: string[];
  wireguard?: {
    enabled: boolean;
    available: boolean;
    reason?: string;
    interfaceName?: string;
    endpointHost?: string;
    endpointPort?: number;
    clientName?: string;
    proxyHost?: string | null;
    proxyPort?: number;
    requiresManualProxy?: boolean;
    transparentInterceptEnabled?: boolean;
    transparentInterceptPort?: number;
    tunnelConnected?: boolean;
    lastHandshakeAt?: number | null;
    downloadPath?: string;
    configText?: string;
  };
  warnings?: string[];
}

interface ProxyHealthInfo {
  host: string;
  port: number;
  ok: boolean;
  status: 'reachable' | 'unreachable';
  latencyMs: number;
  checkedAt: string;
  error: string | null;
}

function safeHostname(url?: string): string {
  if (!url) return '';
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function toWsBaseEndpoint(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return url.split('?')[0] || url;
  }
}

function ApikQrCode({ value, size = 132, level = 'H' }: { value: string; size?: number; level?: 'L' | 'M' | 'Q' | 'H' }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!value) {
      setFailed(false);
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    let active = true;
    void QRCode.toCanvas(canvas, value, {
      width: size,
      margin: 2,
      color: { dark: '#0f172a', light: '#ffffff' },
      errorCorrectionLevel: level,
    }).then(() => {
      if (active) {
        setFailed(false);
      }
    }).catch(() => {
      if (active) {
        setFailed(true);
      }
    });

    return () => {
      active = false;
    };
  }, [level, size, value]);

  if (!value) {
    return null;
  }

  if (failed) {
    return (
      <div
        className="border border-app-border rounded bg-app-panel text-app-muted text-[11px] flex items-center justify-center"
        style={{ width: size, height: size }}
      >
        QR unavailable
      </div>
    );
  }

  return <canvas ref={canvasRef} width={size} height={size} className="border border-app-border rounded bg-white" />;
}

export default function InterceptPanel() {
  const {
    interceptedRequests,
    collections,
    addRequestToCollection,
    interceptEnabled,
    setInterceptEnabled,
    forwardInterceptedRequest,
    dropInterceptedRequest,
    clearInterceptedRequests,
    wsConnected,
    authReady,
    isAuthenticated,
    userId,
    interceptSearchQuery,
    setInterceptSearchQuery,
  } = useAppStore();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editedHeaders, setEditedHeaders] = useState('');
  const [editedBody, setEditedBody] = useState('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'http' | 'https' | 'pending'>('all');
  const [showProxyGuide, setShowProxyGuide] = useState(false);
  const [proxySetup, setProxySetup] = useState<ProxySetupInfo | null>(null);
  const [proxySetupError, setProxySetupError] = useState('');
  const [proxyHealth, setProxyHealth] = useState<ProxyHealthInfo | null>(null);
  const [wireGuardQrValue, setWireGuardQrValue] = useState('');
  const [showStandardProxyValues, setShowStandardProxyValues] = useState(true);
  const [checkingHealth, setCheckingHealth] = useState(false);
  const [autoForward, setAutoForward] = useState(false);
  const [detailTab, setDetailTab] = useState<'summary' | 'request' | 'response' | 'collection'>('summary');
  const [savingCollectionId, setSavingCollectionId] = useState<string | null>(null);
  const [beautifiedResponseBody, setBeautifiedResponseBody] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const handleFind = () => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    };
    window.addEventListener('__apix_find__', handleFind as EventListener);
    return () => window.removeEventListener('__apix_find__', handleFind as EventListener);
  }, []);

  const scopeId = useMemo(() => {
    try {
      return localStorage.getItem('apik.ws.scopeId') || '-';
    } catch {
      return '-';
    }
  }, []);

  useEffect(() => {
    if (!authReady || !isAuthenticated || !userId) {
      setProxySetup(null);
      setProxySetupError('');
      setWireGuardQrValue('');
      return;
    }

    let cancelled = false;

    const loadProxySetup = async (silent = false) => {
      try {
        const { data } = await apiClient.get<ProxySetupInfo>('/intercept/proxy-setup');
        if (!cancelled) {
          setProxySetup(data);
          if (!silent) {
            setProxySetupError('');
          }
        }
      } catch {
        if (!cancelled) {
          if (!silent) {
            setProxySetup(null);
            setProxySetupError('Failed to load proxy setup. Check backend auth/session.');
          }
        }
      }
    };

    void loadProxySetup(false);

    let pollTimer: number | null = null;
    if (showProxyGuide) {
      pollTimer = window.setInterval(() => {
        void loadProxySetup(true);
      }, 3000);
    }

    return () => {
      cancelled = true;
      if (pollTimer != null) {
        window.clearInterval(pollTimer);
      }
    };
  }, [authReady, isAuthenticated, showProxyGuide, userId]);

  useEffect(() => {
    if (!isAuthenticated || !proxySetup?.wireguard?.enabled) {
      setWireGuardQrValue('');
      return;
    }

    const inlineConfig = String(proxySetup.wireguard.configText || '').trim();
    if (inlineConfig) {
      setWireGuardQrValue(inlineConfig);
      return;
    }

    if (!proxySetup.wireguard.downloadPath) {
      setWireGuardQrValue('');
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    const loadWireGuardConfigForQr = async () => {
      try {
        const response = await apiClient.get<string>(proxySetup.wireguard!.downloadPath!, {
          responseType: 'text',
          signal: controller.signal,
        });
        const raw = typeof response.data === 'string' ? response.data.trim() : '';
        if (!cancelled) {
          setWireGuardQrValue(raw);
        }
      } catch {
        if (!cancelled) {
          setWireGuardQrValue('');
        }
      }
    };

    void loadWireGuardConfigForQr();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [isAuthenticated, proxySetup?.wireguard?.downloadPath, proxySetup?.wireguard?.enabled]);

  const hasWireGuardTunnelProxy = Boolean(
    proxySetup?.wireguard?.requiresManualProxy
    && proxySetup?.wireguard?.proxyHost
    && proxySetup?.wireguard?.tunnelConnected,
  );

  useEffect(() => {
    setShowStandardProxyValues(!hasWireGuardTunnelProxy);
  }, [hasWireGuardTunnelProxy]);

  useEffect(() => {
    if (!autoForward) return;
    const pending = interceptedRequests.filter((request) => request.status === 'pending');
    if (pending.length === 0) return;
    pending.forEach((request) => forwardInterceptedRequest(request.id));
  }, [autoForward, interceptedRequests, forwardInterceptedRequest]);

  const visibleRequests = useMemo(() => {
    const sorted = [...interceptedRequests].sort((a, b) => b.timestamp - a.timestamp);
    let filtered = sorted;

    if (activeFilter === 'pending') {
      filtered = filtered.filter((request) => request.status === 'pending');
    } else if (activeFilter !== 'all') {
      filtered = filtered.filter((request) => String(request.url || '').toLowerCase().startsWith(`${activeFilter}:`));
    }

    if (interceptSearchQuery.trim()) {
      const q = interceptSearchQuery.toLowerCase().trim();
      const contains = (value: unknown) => String(value ?? '').toLowerCase().includes(q);
      const containsInHeaders = (headers?: Record<string, string>) => Object.entries(headers || {}).some(
        ([k, v]) => contains(k) || contains(v),
      );

      filtered = filtered.filter((request) => {
        if (contains(request.id)) return true;
        if (contains(request.tabId)) return true;
        if (contains(request.tabUrl)) return true;
        if (contains(request.source)) return true;
        if (contains(request.status)) return true;
        if (contains(request.method)) return true;
        if (contains(request.url)) return true;
        if (contains(request.timestamp)) return true;
        if (contains(request.body)) return true;
        if (containsInHeaders(request.headers)) return true;
        if (contains(request.responseStatusCode)) return true;
        if (contains(request.responseTimestamp)) return true;
        if (contains(request.responseBody)) return true;
        if (containsInHeaders(request.responseHeaders)) return true;
        return false;
      });
    }

    return filtered;
  }, [activeFilter, interceptSearchQuery, interceptedRequests]);

  const selected = useMemo(
    () => interceptedRequests.find((request) => request.id === selectedId) || null,
    [interceptedRequests, selectedId],
  );

  useEffect(() => {
    if (visibleRequests.length === 0) {
      if (selectedId !== null) {
        setSelectedId(null);
      }
      return;
    }

    if (!selectedId || !visibleRequests.some((request) => request.id === selectedId)) {
      const first = visibleRequests[0];
      setSelectedId(first.id);
      setEditedHeaders(JSON.stringify(first.headers, null, 2));
      setEditedBody(first.body || '');
      setDetailTab('summary');
    }
  }, [visibleRequests, selectedId]);

  const pendingCount = interceptedRequests.filter((request) => request.status === 'pending').length;
  const wsBaseEndpoint = toWsBaseEndpoint(getWsInterceptUrl());
  const certQrValue = proxySetup?.caDownloadUrl || '';

  const filterButtons: Array<{ key: 'all' | 'http' | 'https' | 'pending'; label: string }> = [
    { key: 'all', label: `All (${interceptedRequests.length})` },
    { key: 'http', label: 'Http' },
    { key: 'https', label: 'Https' },
    { key: 'pending', label: `Pending (${pendingCount})` },
  ];

  const rowStatusColor = (status: InterceptedRequest['status']) => {
    if (status === 'pending') return 'text-orange-300';
    if (status === 'forwarded') return 'text-green-300';
    if (status === 'dropped') return 'text-red-300';
    return 'text-app-muted';
  };

  const copyText = async (value: string) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Ignore clipboard issues.
    }
  };

  const checkProxyHealth = async () => {
    if (!isAuthenticated) {
      return;
    }
    setCheckingHealth(true);
    try {
      const { data } = await apiClient.get<ProxyHealthInfo>('/intercept/proxy-health');
      setProxyHealth(data);
    } catch {
      setProxyHealth(null);
    } finally {
      setCheckingHealth(false);
    }
  };

  const handleSelect = (request: InterceptedRequest) => {
    setSelectedId(request.id);
    setEditedHeaders(JSON.stringify(request.headers, null, 2));
    setEditedBody(request.body || '');
    setBeautifiedResponseBody(null);
    setDetailTab('summary');
  };

  const handleBeautifyBody = () => {
    if (!selected) return;
    const contentType = selected.headers['content-type'] || selected.headers['Content-Type'] || '';
    const language = detectLanguage(contentType, editedBody || '');
    if (!canBeautifyContent(editedBody || '', language, contentType)) return;
    setEditedBody(beautifyContent(editedBody || '', language, contentType));
  };

  const handleBeautifyResponseBody = () => {
    if (!selected?.responseBody) return;
    const contentType = selected.responseHeaders?.['content-type'] || selected.responseHeaders?.['Content-Type'] || '';
    const language = detectLanguage(contentType, selected.responseBody);
    if (!canBeautifyContent(selected.responseBody, language, contentType)) return;
    setBeautifiedResponseBody(beautifyContent(selected.responseBody, language, contentType));
  };

  const responseBodyToRender = beautifiedResponseBody ?? selected?.responseBody ?? '';

  const handleForward = (id: string) => {
    if (selectedId === id) {
      try {
        const headers = JSON.parse(editedHeaders || '{}');
        forwardInterceptedRequest(id, {
          ...selected,
          headers,
          body: editedBody || undefined,
        });
      } catch {
        forwardInterceptedRequest(id);
      }
    } else {
      forwardInterceptedRequest(id);
    }
  };

  const handleDrop = (id: string) => {
    dropInterceptedRequest(id);
    if (selectedId === id) {
      setSelectedId(null);
    }
  };

  const handleAddToCollection = async (collectionId: string, request: InterceptedRequest) => {
    const contentType = (request.headers['content-type'] || request.headers['Content-Type'] || '').toLowerCase();
    const bodyType = request.body
      ? (contentType.includes('json')
        ? 'json'
        : contentType.includes('xml')
          ? 'xml'
          : contentType.includes('graphql')
            ? 'graphql'
            : 'text')
      : 'none';

    const headerEntries = Object.entries(request.headers || {}).map(([key, value], index) => ({
      id: `${request.id}-h-${index}`,
      key,
      value: String(value),
      enabled: true,
    }));

    let requestName = `${request.method} Request`;
    try {
      const parsed = new URL(request.url);
      requestName = `${request.method} ${parsed.pathname || '/'}`;
    } catch {
      requestName = `${request.method} ${safeHostname(request.url) || 'Request'}`;
    }

    try {
      setSavingCollectionId(collectionId);
      await addRequestToCollection(collectionId, {
        name: requestName,
        method: (request.method || 'GET') as HttpMethod,
        url: request.url,
        headers: headerEntries,
        body: {
          type: bodyType,
          content: request.body || '',
        },
      });
      toast.success('Request added to collection');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to add request to collection');
    } finally {
      setSavingCollectionId(null);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-app-bg">
      <div className="flex items-center justify-between px-4 py-3 border-b border-app-border bg-app-sidebar flex-shrink-0">
        <div className="flex items-center gap-2">
          <Shield size={16} className="text-app-accent" />
          <span className="font-semibold text-app-text">Traffic</span>
          {pendingCount > 0 && (
            <span className="bg-orange-500 text-white text-xs rounded-full px-2 py-0.5">
              {pendingCount} pending
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div
            className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded ${
              interceptEnabled ? 'bg-orange-900/40 text-orange-300' : 'bg-app-active text-app-muted'
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                interceptEnabled ? 'bg-orange-400 animate-pulse' : 'bg-app-muted'
              }`}
            />
            {interceptEnabled ? 'Intercepting' : 'Off'}
          </div>
          <button
            onClick={() => setInterceptEnabled(!interceptEnabled)}
            disabled={!isAuthenticated}
            className={`text-xs px-3 py-1 rounded font-medium transition-colors ${
              interceptEnabled
                ? 'bg-app-active hover:bg-app-hover text-app-muted'
                : 'bg-app-accent hover:bg-app-accent-hover text-white'
            } ${!isAuthenticated ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            {!isAuthenticated ? 'Login required' : (interceptEnabled ? 'Stop' : 'Start')}
          </button>
          {interceptedRequests.length > 0 && (
            <button onClick={clearInterceptedRequests} className="btn-ghost text-xs" title="Clear all">
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>

      {!wsConnected && (
        <div className="px-4 py-2 bg-yellow-900/30 border-b border-yellow-800/50 text-yellow-300 text-xs flex items-center gap-2 justify-between">
          <span>Not connected to backend WebSocket — auto-reconnecting…</span>
          <button
            onClick={() => void useAppStore.getState().initWebSocket()}
            className="flex items-center gap-1 px-2 py-1 rounded border border-yellow-700/60 hover:bg-yellow-900/50 whitespace-nowrap flex-shrink-0"
          >
            <RefreshCw size={11} />
            Reconnect now
          </button>
        </div>
      )}

      {!isAuthenticated && (
        <div className="px-4 py-2 bg-yellow-900/30 border-b border-yellow-800/50 text-yellow-300 text-xs">
          Intercept mode is available only for logged-in users.
        </div>
      )}

      {isAuthenticated && (
        <div className="px-4 py-2 border-b border-app-border bg-app-sidebar/40 text-xs text-app-muted grid grid-cols-1 md:grid-cols-3 gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <User size={12} className="text-app-accent" />
            <span className="truncate">User: {userId || '-'}</span>
          </div>
          <div className="flex items-center gap-2 min-w-0">
            <Filter size={12} className="text-app-accent" />
            <span className="truncate">Scope: {scopeId}</span>
          </div>
          <div className="flex items-center gap-2 min-w-0">
            <Wifi size={12} className="text-app-accent" />
            <span className="truncate">Proxy WS: {wsBaseEndpoint}</span>
          </div>
        </div>
      )}

      {isAuthenticated && (
        <div className="border-b border-app-border bg-app-sidebar/30">
          <div className="px-4 py-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs text-app-muted">
              <Smartphone size={12} className="text-app-accent" />
              iPhone/Android Proxy Guide
            </div>
            <button
              onClick={() => setShowProxyGuide((value) => !value)}
              className="text-xs px-2 py-1 rounded border border-app-border text-app-muted hover:text-app-text hover:bg-app-hover"
            >
              {showProxyGuide ? 'Hide' : 'Show'}
            </button>
          </div>

          {showProxyGuide && (
            <div className="px-4 pb-3 grid grid-cols-1 xl:grid-cols-[1.2fr_0.8fr] gap-3 text-xs max-h-[55vh] overflow-y-auto pr-1">
              <div className="border border-app-border rounded-md p-3 bg-app-panel space-y-3">
                {proxySetupError ? <div className="text-red-300">{proxySetupError}</div> : null}
                {proxySetup ? (
                  <>
                    {proxySetup.wireguard?.enabled ? (
                      <div className="rounded border border-app-border bg-app-sidebar px-2 py-1.5 text-[11px] space-y-1 text-app-muted">
                        <p className="text-app-text">WireGuard live status</p>
                        <div className="flex items-center gap-2">
                          <span className={`inline-block w-2 h-2 rounded-full ${proxySetup.wireguard.tunnelConnected ? 'bg-green-400' : 'bg-red-400'}`} />
                          <span className={proxySetup.wireguard.tunnelConnected ? 'text-green-300' : 'text-red-300'}>
                            {proxySetup.wireguard.tunnelConnected
                              ? 'CONNECTED (handshake active)'
                              : 'DISCONNECTED (no recent handshake)'}
                          </span>
                        </div>
                        {typeof proxySetup.wireguard.lastHandshakeAt === 'number' ? (
                          <p>Last handshake: {new Date(proxySetup.wireguard.lastHandshakeAt).toLocaleString()}</p>
                        ) : null}
                      </div>
                    ) : null}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-app-muted">
                      <div className="space-y-2">
                        <div className="rounded border border-app-border bg-app-sidebar px-2 py-1.5 text-[11px] space-y-1">
                          <p className="text-app-text">Recommended now (auto-check)</p>
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate">
                              Host: {proxySetup.recommendedProxyHost || proxySetup.host}
                              {' '}
                              ({proxySetup.recommendedProxySource === 'wireguard' ? 'WireGuard connected' : 'public host'})
                            </span>
                            <button
                              onClick={() => void copyText(String(proxySetup.recommendedProxyHost || proxySetup.host))}
                              className="p-1 hover:bg-app-hover rounded"
                              title="Copy recommended host"
                            >
                              <Copy size={12} />
                            </button>
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <span>Port: {proxySetup.recommendedProxyPort ?? proxySetup.port}</span>
                            <button
                              onClick={() => void copyText(String(proxySetup.recommendedProxyPort ?? proxySetup.port))}
                              className="p-1 hover:bg-app-hover rounded"
                              title="Copy recommended port"
                            >
                              <Copy size={12} />
                            </button>
                          </div>
                        </div>

                        <div className="rounded border border-app-border bg-app-sidebar px-2 py-1.5 text-[11px] space-y-1">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-app-text">Standard proxy setup</p>
                            {hasWireGuardTunnelProxy ? (
                              <button
                                onClick={() => setShowStandardProxyValues((value) => !value)}
                                className="px-2 py-0.5 rounded border border-app-border hover:bg-app-hover"
                              >
                                {showStandardProxyValues ? 'Hide' : 'Show'}
                              </button>
                            ) : null}
                          </div>
                          <p>Use this when device is not connected through WireGuard.</p>
                        </div>
                        {showStandardProxyValues ? (
                          <>
                            <div className="flex items-center justify-between gap-2">
                              <span className="truncate">Host: {proxySetup.host}</span>
                              <button onClick={() => void copyText(proxySetup.host)} className="p-1 hover:bg-app-hover rounded" title="Copy host">
                                <Copy size={12} />
                              </button>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                              <span>Port: {proxySetup.port}</span>
                              <button onClick={() => void copyText(String(proxySetup.port))} className="p-1 hover:bg-app-hover rounded" title="Copy port">
                                <Copy size={12} />
                              </button>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                              <span className="truncate">URL: {proxySetup.proxyUrl}</span>
                              <button onClick={() => void copyText(proxySetup.proxyUrl)} className="p-1 hover:bg-app-hover rounded" title="Copy proxy URL">
                                <Copy size={12} />
                              </button>
                            </div>
                          </>
                        ) : (
                          <p className="text-[11px]">Hidden while WireGuard mode is active.</p>
                        )}
                      </div>
                      <div className="space-y-2 text-app-muted">
                        {proxySetup.wireguard?.requiresManualProxy && proxySetup.wireguard.proxyHost ? (
                          <div className="rounded border border-app-border bg-app-sidebar px-2 py-1.5 text-[11px] space-y-1">
                            <p className="text-app-text">WireGuard mode</p>
                            <p>WireGuard secures tunnel path, but intercept still needs Manual Proxy with these values:</p>
                            <div className="flex items-center justify-between gap-2">
                              <span className="truncate">Tunnel proxy host: {proxySetup.wireguard.proxyHost}</span>
                              <button onClick={() => void copyText(String(proxySetup.wireguard?.proxyHost || ''))} className="p-1 hover:bg-app-hover rounded" title="Copy tunnel proxy host">
                                <Copy size={12} />
                              </button>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                              <span>Tunnel proxy port: {proxySetup.wireguard.proxyPort ?? proxySetup.port}</span>
                              <button onClick={() => void copyText(String(proxySetup.wireguard?.proxyPort ?? proxySetup.port))} className="p-1 hover:bg-app-hover rounded" title="Copy tunnel proxy port">
                                <Copy size={12} />
                              </button>
                            </div>
                          </div>
                        ) : null}
                        {proxySetup.wireguard?.enabled && !proxySetup.wireguard?.requiresManualProxy ? (
                          <div className="rounded border border-green-700/40 bg-green-900/20 px-2 py-1.5 text-[11px] space-y-1 text-green-200">
                            <p className="text-green-100">WireGuard transparent mode</p>
                            <p>Proxy on phone can stay Off/None. APIK intercept is redirected automatically over the WireGuard tunnel.</p>
                            {proxySetup.wireguard.transparentInterceptPort ? (
                              <p className="text-[11px]">Server redirect target port: {proxySetup.wireguard.transparentInterceptPort}</p>
                            ) : null}
                          </div>
                        ) : null}
                        <div className="rounded border border-app-border bg-app-sidebar px-2 py-1.5 text-[11px]">
                          <p className="text-app-text">Port lease</p>
                          <p>{proxySetup.portExpiresAt ? new Date(proxySetup.portExpiresAt).toLocaleString() : 'Long-lived assignment (up to 180 days)'}</p>
                        </div>
                      </div>
                    </div>

                    <div className="border border-app-border rounded-md p-3 bg-app-sidebar/40 text-app-muted space-y-2">
                      <div className="flex items-center gap-2">
                        <Activity size={12} className="text-app-accent" />
                        Proxy reachability from backend
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <button
                          onClick={() => void checkProxyHealth()}
                          disabled={checkingHealth}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded border border-app-border hover:bg-app-hover text-app-text disabled:opacity-60"
                        >
                          <RefreshCw size={11} className={checkingHealth ? 'animate-spin' : ''} />
                          {checkingHealth ? 'Checking...' : 'Check now'}
                        </button>
                        {proxyHealth ? (
                          <span className={proxyHealth.ok ? 'text-green-300' : 'text-red-300'}>
                            {proxyHealth.status} ({proxyHealth.latencyMs}ms){proxyHealth.error ? ` - ${proxyHealth.error}` : ''}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    {proxySetup.wireguard?.enabled ? (
                      <div className="border border-app-border rounded-md p-3 bg-app-sidebar/40 text-app-muted space-y-2">
                        <div className="flex items-center gap-2">
                          <ShieldCheck size={12} className="text-app-accent" />
                          WireGuard (auto per-user)
                        </div>
                        {proxySetup.wireguard.available ? (
                          <>
                            <p className="text-[11px]">
                              Profile: <span className="text-app-text">{proxySetup.wireguard.clientName || '-'}</span>
                              {' '}| Endpoint: <span className="text-app-text">{proxySetup.wireguard.endpointHost}:{proxySetup.wireguard.endpointPort}</span>
                            </p>
                            {proxySetup.wireguard.requiresManualProxy && proxySetup.wireguard.proxyHost ? (
                              <div className="rounded border border-app-border bg-app-sidebar px-2 py-1.5 text-[11px] space-y-1">
                                <p className="text-app-text">WireGuard tunnel is active. APIK intercept currently still relies on Manual Proxy.</p>
                                {typeof proxySetup.wireguard.lastHandshakeAt === 'number' ? (
                                  <p className="text-[11px]">Last handshake: {new Date(proxySetup.wireguard.lastHandshakeAt).toLocaleString()}</p>
                                ) : null}
                                <div className="flex items-center justify-between gap-2">
                                  <span className="truncate">Proxy host over tunnel: {proxySetup.wireguard.proxyHost}</span>
                                  <button onClick={() => void copyText(String(proxySetup.wireguard?.proxyHost || ''))} className="p-1 hover:bg-app-hover rounded" title="Copy WireGuard proxy host">
                                    <Copy size={12} />
                                  </button>
                                </div>
                                <div className="flex items-center justify-between gap-2">
                                  <span>Proxy port over tunnel: {proxySetup.wireguard.proxyPort ?? proxySetup.port}</span>
                                  <button onClick={() => void copyText(String(proxySetup.wireguard?.proxyPort ?? proxySetup.port))} className="p-1 hover:bg-app-hover rounded" title="Copy WireGuard proxy port">
                                    <Copy size={12} />
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div className="rounded border border-green-700/40 bg-green-900/20 px-2 py-1.5 text-[11px] space-y-1 text-green-200">
                                <p className="text-green-100">WireGuard tunnel is active with transparent intercept.</p>
                                <p>No manual proxy needed on phone. Keep proxy set to Off/None.</p>
                                {proxySetup.wireguard.transparentInterceptPort ? (
                                  <p>Server redirect port: {proxySetup.wireguard.transparentInterceptPort}</p>
                                ) : null}
                              </div>
                            )}
                            {proxySetup.wireguard.downloadPath ? (
                              <div className="flex items-center gap-3 flex-wrap">
                                <a
                                  href={proxySetup.wireguard.downloadPath}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1 text-app-accent hover:underline"
                                >
                                  Download my WireGuard profile (.conf)
                                  <ExternalLink size={12} />
                                </a>
                                <div className="flex items-center gap-2">
                                  <span className="text-[11px]">Scan QR:</span>
                                  <ApikQrCode value={wireGuardQrValue} size={220} level="M" />
                                </div>
                              </div>
                            ) : null}
                            <p className="text-[11px]">Each user gets a dedicated profile automatically. Do not share profile files.</p>
                          </>
                        ) : (
                          <>
                            {proxySetup.wireguard.reason === 'wireguard_interface_down' ? (
                              <>
                                <p className="text-[11px] text-yellow-300">
                                  WireGuard interface is down — the server needs a reboot to load the new kernel.
                                  Your profile has already been generated.
                                </p>
                                {proxySetup.wireguard.downloadPath ? (
                                  <div className="flex items-center gap-3 flex-wrap">
                                    <a
                                      href={proxySetup.wireguard.downloadPath}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="inline-flex items-center gap-1 text-app-accent hover:underline"
                                    >
                                      Download my WireGuard profile (.conf) — ready for after reboot
                                      <ExternalLink size={12} />
                                    </a>
                                    <div className="flex items-center gap-2">
                                      <span className="text-[11px]">Scan QR:</span>
                                      <ApikQrCode value={wireGuardQrValue} size={220} level="M" />
                                    </div>
                                  </div>
                                ) : null}
                              </>
                            ) : (
                              <p className="text-[11px] text-yellow-300">
                                WireGuard not available: {proxySetup.wireguard.reason || 'unknown'}
                              </p>
                            )}
                          </>
                        )}
                      </div>
                    ) : null}

                    {proxySetup.caDownloadUrl ? (
                      <div className="flex items-center gap-3 flex-wrap text-app-muted">
                        <span>CA: <span className="text-app-text">{proxySetup.caCommonName}</span></span>
                        <a
                          href={proxySetup.caDownloadUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-app-accent hover:underline"
                        >
                          Download certificate
                          <ExternalLink size={12} />
                        </a>
                        <ApikQrCode value={certQrValue} size={112} />
                      </div>
                    ) : null}

                    {proxySetup.notes?.length ? (
                      <ul className="list-disc list-inside space-y-1 text-app-muted">
                        {proxySetup.notes.map((note, index) => (
                          <li key={`${note}-${index}`}>{note}</li>
                        ))}
                      </ul>
                    ) : null}

                    {proxySetup.warnings?.length ? (
                      <ul className="list-disc list-inside space-y-1 text-yellow-300">
                        {proxySetup.warnings.map((warning, index) => (
                          <li key={`${warning}-${index}`}>{warning}</li>
                        ))}
                      </ul>
                    ) : null}
                  </>
                ) : null}
              </div>

              <div className="border border-app-border rounded-md p-3 bg-app-panel text-app-muted space-y-2">
                <p className="font-semibold text-app-text">Phone setup (Proxy or WireGuard)</p>
                <ol className="list-decimal list-inside space-y-1">
                  <li>If you want normal proxy mode: open Wi-Fi details on the device, set Proxy to Manual, then use the Standard proxy Host and Port shown on the left.</li>
                  <li>If you want WireGuard mode: import your own per-user <span className="text-app-text">.conf</span> profile into the WireGuard app and connect it first.</li>
                  <li>If WireGuard transparent mode is shown as active on the left, keep phone proxy Off/None. If not, set Proxy to Manual and use the Tunnel proxy host/port.</li>
                  <li>No username is required in the UI. User isolation is mapped by assigned proxy port (manual mode) or WireGuard client IP (transparent mode).</li>
                  <li>Install the CA certificate and enable Full Trust for HTTPS interception.</li>
                  <li>Do not share WireGuard profiles between users to keep intercept traffic isolated.</li>
                  <li>If traffic stops, refresh the Traffic tab and copy the currently assigned proxy port again.</li>
                </ol>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="px-3 py-2 border-b border-app-border bg-app-panel flex items-center gap-2 overflow-x-auto flex-shrink-0">
        {filterButtons.map((item) => (
          <button
            key={item.key}
            onClick={() => setActiveFilter(item.key)}
            className={`text-xs px-2.5 py-1 rounded border transition-colors whitespace-nowrap flex-shrink-0 ${
              activeFilter === item.key
                ? 'border-app-accent bg-app-active text-app-text'
                : 'border-app-border text-app-muted hover:text-app-text hover:bg-app-hover'
            }`}
          >
            {item.label}
          </button>
        ))}
        <div className="relative flex-1 min-w-[120px]">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-app-muted pointer-events-none" />
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Search all traffic (URL, headers, request/response body, etc.) (Ctrl+F)"
            value={interceptSearchQuery}
            onChange={(e) => setInterceptSearchQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { setInterceptSearchQuery(''); e.currentTarget.blur(); } }}
            className="input-field text-xs py-1 pl-7 pr-7 h-7"
          />
          {interceptSearchQuery && (
            <button
              onClick={() => setInterceptSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-app-muted hover:text-app-text"
            >
              <XIcon size={11} />
            </button>
          )}
        </div>
        <button
          onClick={() => setAutoForward((value) => !value)}
          className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded border transition-colors whitespace-nowrap flex-shrink-0 ${
            autoForward
              ? 'border-green-600 bg-green-900/40 text-green-300'
              : 'border-app-border text-app-muted hover:text-app-text hover:bg-app-hover'
          }`}
          title="Auto-forward all pending requests without pausing"
        >
          <Zap size={12} />
          Auto Forward
        </button>
      </div>

      {interceptedRequests.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 text-app-muted p-6">
          <ShieldCheck size={48} className="opacity-20" />
          <div className="text-center max-w-sm">
            <p className="text-sm font-medium text-app-text mb-2">No traffic yet</p>
            <p className="text-xs leading-relaxed">
              Install the APIK browser extension or configure the mobile proxy, then send a request. Traffic will appear here with a live preview panel.
            </p>
          </div>
        </div>
      ) : (
        <PanelGroup direction="horizontal" id="traffic-split" className="flex-1 min-h-0">
          <Panel id="traffic-list" defaultSize={35} minSize={18} maxSize={60}>
            <div className="h-full border-r border-app-border bg-app-panel/70 flex flex-col">
              <div className="px-3 py-2 border-b border-app-border text-[11px] uppercase tracking-wider text-app-muted flex items-center justify-between flex-shrink-0">
                <span>Traffic List</span>
                <span>{visibleRequests.length}/{interceptedRequests.length}</span>
              </div>
              {visibleRequests.length === 0 ? (
                <div className="flex-1 flex items-center justify-center text-app-muted text-xs p-4 text-center">
                  No results match the current filter.
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto">
                  {visibleRequests.map((request) => (
                    <button
                      key={request.id}
                      onClick={() => handleSelect(request)}
                      className={`w-full text-left px-3 py-2.5 border-b border-app-border/60 transition-colors ${
                        selectedId === request.id ? 'bg-app-active' : 'hover:bg-app-hover'
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <span className={`mt-0.5 text-[11px] font-mono font-bold px-1.5 py-0.5 rounded ${METHOD_BG_COLORS[request.method as HttpMethod] || 'bg-app-active text-app-muted'}`}>
                          {request.method}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm text-app-text truncate">{request.url}</div>
                          <div className="mt-1 flex items-center gap-2 text-[11px] text-app-muted flex-wrap">
                            <span>{safeHostname(request.url)}</span>
                            <span className={rowStatusColor(request.status)}>{request.status}</span>
                            {typeof request.responseStatusCode === 'number' ? <span>HTTP {request.responseStatusCode}</span> : null}
                            <span>{new Date(request.timestamp).toLocaleTimeString()}</span>
                            {request.source === 'mobile-proxy' ? (
                              <span className="px-1 py-0.5 rounded bg-blue-900/40 text-blue-300">mobile</span>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </Panel>

          <PanelResizeHandle className="w-1 bg-app-border hover:bg-app-accent transition-colors cursor-col-resize flex-shrink-0" />

          <Panel id="traffic-detail" defaultSize={65} minSize={30}>
            <div className="h-full flex flex-col overflow-hidden">
              {selected ? (
                <div className="h-full flex flex-col overflow-hidden">
                  <div className="px-4 py-3 border-b border-app-border bg-app-sidebar flex items-center justify-between gap-3 flex-shrink-0">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-[11px] font-mono font-bold px-1.5 py-0.5 rounded ${METHOD_BG_COLORS[selected.method as HttpMethod] || 'bg-app-active text-app-muted'}`}>
                          {selected.method}
                        </span>
                        <p className="text-sm font-mono text-app-text truncate">{selected.url}</p>
                      </div>
                      <p className="text-xs text-app-muted">
                        {new Date(selected.timestamp).toLocaleString()}
                        {selected.tabUrl ? ` | from ${safeHostname(selected.tabUrl)}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={() => handleForward(selected.id)}
                        className="flex items-center gap-1.5 bg-green-700 hover:bg-green-600 text-white text-xs px-3 py-1.5 rounded font-medium"
                      >
                        <CheckCircle size={13} />
                        Forward
                      </button>
                      <button
                        onClick={() => handleDrop(selected.id)}
                        className="flex items-center gap-1.5 bg-red-900/60 hover:bg-red-800 text-red-300 text-xs px-3 py-1.5 rounded"
                      >
                        <XCircle size={13} />
                        Drop
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center border-b border-app-border bg-app-sidebar flex-shrink-0 overflow-x-auto">
                    {(['summary', 'request', 'response', 'collection'] as const).map((tab) => (
                      <button
                        key={tab}
                        onClick={() => setDetailTab(tab)}
                        className={`tab-btn flex-shrink-0 ${detailTab === tab ? 'active' : ''}`}
                      >
                        {tab.charAt(0).toUpperCase() + tab.slice(1)}
                      </button>
                    ))}
                    {detailTab === 'request' && (
                      <button
                        onClick={handleBeautifyBody}
                        className="ml-auto mr-2 flex items-center gap-1 px-2 py-1 text-xs rounded border border-app-border text-app-muted hover:text-app-text hover:bg-app-hover"
                      >
                        <Wand2 size={12} />
                        Beautify
                      </button>
                    )}
                  </div>

                  <div className="flex-1 overflow-hidden">
                    {detailTab === 'summary' && (
                      <div className="h-full overflow-y-auto p-4 grid grid-cols-1 xl:grid-cols-2 gap-4 text-xs">
                        <div className="border border-app-border rounded-lg bg-app-panel overflow-hidden">
                          <div className="px-3 py-2 border-b border-app-border bg-app-sidebar text-app-muted uppercase tracking-wider">Request</div>
                          <div className="p-3 space-y-2 text-app-muted">
                            <div><span className="text-app-text">Method:</span> {selected.method}</div>
                            <div><span className="text-app-text">Host:</span> {safeHostname(selected.url)}</div>
                            <div><span className="text-app-text">URL:</span> <span className="break-all">{selected.url}</span></div>
                            <div><span className="text-app-text">Captured:</span> {new Date(selected.timestamp).toLocaleString()}</div>
                            <div><span className="text-app-text">Headers:</span> {Object.keys(selected.headers || {}).length}</div>
                            <div><span className="text-app-text">Body bytes:</span> {selected.body?.length || 0}</div>
                          </div>
                        </div>
                        <div className="border border-app-border rounded-lg bg-app-panel overflow-hidden">
                          <div className="px-3 py-2 border-b border-app-border bg-app-sidebar text-app-muted uppercase tracking-wider">Response</div>
                          <div className="p-3 space-y-2 text-app-muted">
                            <div><span className="text-app-text">Status:</span> {selected.responseStatusCode ?? 'Waiting'}</div>
                            <div><span className="text-app-text">Response headers:</span> {Object.keys(selected.responseHeaders || {}).length}</div>
                            <div><span className="text-app-text">Completed:</span> {selected.responseTimestamp ? new Date(selected.responseTimestamp).toLocaleString() : '-'}</div>
                            <div><span className="text-app-text">Source:</span> {selected.source || 'extension'}</div>
                            <div><span className="text-app-text">State:</span> <span className={rowStatusColor(selected.status)}>{selected.status}</span></div>
                          </div>
                        </div>
                        <div className="xl:col-span-2 border border-app-border rounded-lg bg-app-panel overflow-hidden">
                          <div className="px-3 py-2 border-b border-app-border bg-app-sidebar text-app-muted uppercase tracking-wider flex items-center justify-between gap-2">
                            <span>Response Preview</span>
                            <div className="flex items-center gap-1 normal-case">
                              <button
                                onClick={handleBeautifyResponseBody}
                                disabled={!selected.responseBody}
                                className="flex items-center gap-1 px-2 py-1 text-xs rounded border border-app-border text-app-muted hover:text-app-text hover:bg-app-hover disabled:opacity-50"
                              >
                                <Wand2 size={11} />
                                Beautify
                              </button>
                              {beautifiedResponseBody && (
                                <button
                                  onClick={() => setBeautifiedResponseBody(null)}
                                  className="px-2 py-1 text-xs rounded border border-app-border text-app-muted hover:text-app-text hover:bg-app-hover"
                                >
                                  Raw
                                </button>
                              )}
                            </div>
                          </div>
                          {selected.responseBody ? (
                            <Editor
                              height="280px"
                              language={detectLanguage(
                                selected.responseHeaders?.['content-type'] || selected.responseHeaders?.['Content-Type'] || '',
                                responseBodyToRender,
                              )}
                              value={responseBodyToRender}
                              theme="vs-dark"
                              options={{
                                readOnly: true,
                                minimap: { enabled: false },
                                fontSize: 13,
                                fontFamily: 'JetBrains Mono, Fira Code, Consolas, monospace',
                                lineNumbers: 'on',
                                wordWrap: 'on',
                                scrollBeyondLastLine: false,
                                padding: { top: 8 },
                                automaticLayout: true,
                                tabSize: 2,
                              }}
                            />
                          ) : (
                            <div className="p-4 text-app-muted">Response preview is not available yet for this traffic item.</div>
                          )}
                        </div>
                      </div>
                    )}

                    {detailTab === 'request' && (
                      <div className="h-full grid grid-cols-1 xl:grid-cols-2 gap-0">
                        <div className="border-r border-app-border overflow-hidden">
                          <div className="px-3 py-2 border-b border-app-border bg-app-sidebar text-xs text-app-muted uppercase tracking-wider">
                            Request Headers
                          </div>
                          <Editor
                            height="calc(100% - 33px)"
                            language="json"
                            value={editedHeaders}
                            onChange={(value) => setEditedHeaders(value || '')}
                            theme="vs-dark"
                            options={{
                              minimap: { enabled: false },
                              fontSize: 13,
                              fontFamily: 'JetBrains Mono, Fira Code, Consolas, monospace',
                              lineNumbers: 'on',
                              wordWrap: 'on',
                              scrollBeyondLastLine: false,
                              padding: { top: 8 },
                              automaticLayout: true,
                              tabSize: 2,
                            }}
                          />
                        </div>
                        <div className="overflow-hidden">
                          <div className="px-3 py-2 border-b border-app-border bg-app-sidebar text-xs text-app-muted uppercase tracking-wider">
                            Request Body
                          </div>
                          <Editor
                            height="calc(100% - 33px)"
                            language={detectLanguage(
                              selected.headers['content-type'] || selected.headers['Content-Type'] || '',
                              editedBody,
                            )}
                            value={editedBody || ''}
                            onChange={(value) => setEditedBody(value || '')}
                            theme="vs-dark"
                            options={{
                              minimap: { enabled: false },
                              fontSize: 13,
                              fontFamily: 'JetBrains Mono, Fira Code, Consolas, monospace',
                              lineNumbers: 'on',
                              wordWrap: 'on',
                              scrollBeyondLastLine: false,
                              padding: { top: 8 },
                              automaticLayout: true,
                              tabSize: 2,
                            }}
                          />
                        </div>
                      </div>
                    )}

                    {detailTab === 'response' && (
                      <div className="h-full grid grid-cols-1 xl:grid-cols-2 gap-0">
                        <div className="border-r border-app-border overflow-hidden">
                          <div className="px-3 py-2 border-b border-app-border bg-app-sidebar text-xs text-app-muted uppercase tracking-wider">
                            Response Headers
                          </div>
                          <Editor
                            height="calc(100% - 33px)"
                            language="json"
                            value={JSON.stringify(selected.responseHeaders || {}, null, 2)}
                            theme="vs-dark"
                            options={{
                              readOnly: true,
                              minimap: { enabled: false },
                              fontSize: 13,
                              fontFamily: 'JetBrains Mono, Fira Code, Consolas, monospace',
                              lineNumbers: 'on',
                              wordWrap: 'on',
                              scrollBeyondLastLine: false,
                              padding: { top: 8 },
                              automaticLayout: true,
                              tabSize: 2,
                            }}
                          />
                        </div>
                        <div className="overflow-hidden">
                          <div className="px-3 py-2 border-b border-app-border bg-app-sidebar text-xs text-app-muted uppercase tracking-wider flex items-center justify-between">
                            <span>Response Body</span>
                            <div className="flex items-center gap-2 normal-case">
                              {typeof selected.responseStatusCode === 'number' ? (
                                <span className="text-app-text">HTTP {selected.responseStatusCode}</span>
                              ) : null}
                              <button
                                onClick={handleBeautifyResponseBody}
                                disabled={!selected.responseBody}
                                className="flex items-center gap-1 px-2 py-1 text-xs rounded border border-app-border text-app-muted hover:text-app-text hover:bg-app-hover disabled:opacity-50"
                              >
                                <Wand2 size={11} />
                                Beautify
                              </button>
                              {beautifiedResponseBody && (
                                <button
                                  onClick={() => setBeautifiedResponseBody(null)}
                                  className="px-2 py-1 text-xs rounded border border-app-border text-app-muted hover:text-app-text hover:bg-app-hover"
                                >
                                  Raw
                                </button>
                              )}
                            </div>
                          </div>
                          {selected.responseBody ? (
                            <Editor
                              height="calc(100% - 33px)"
                              language={detectLanguage(
                                selected.responseHeaders?.['content-type'] || selected.responseHeaders?.['Content-Type'] || '',
                                responseBodyToRender,
                              )}
                              value={responseBodyToRender}
                              theme="vs-dark"
                              options={{
                                readOnly: true,
                                minimap: { enabled: false },
                                fontSize: 13,
                                fontFamily: 'JetBrains Mono, Fira Code, Consolas, monospace',
                                lineNumbers: 'on',
                                wordWrap: 'on',
                                scrollBeyondLastLine: false,
                                padding: { top: 8 },
                                automaticLayout: true,
                                tabSize: 2,
                              }}
                            />
                          ) : (
                            <div className="h-[calc(100%-33px)] flex items-center justify-center text-app-muted text-sm p-4">
                              Response body is not available yet.
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {detailTab === 'collection' && (
                      <div className="h-full overflow-y-auto p-4 space-y-3 text-xs">
                        <div className="border border-app-border rounded-lg bg-app-panel p-3 text-app-muted">
                          Save this captured traffic as a collection request. No popup is used here; choose the target collection directly.
                        </div>
                        {collections.length === 0 ? (
                          <div className="border border-app-border rounded-lg bg-app-panel p-4 text-app-muted">
                            No collection available.
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {collections.map((collection) => (
                              <button
                                key={collection.id}
                                onClick={() => void handleAddToCollection(collection.id, selected)}
                                disabled={savingCollectionId === collection.id}
                                className="text-left border border-app-border rounded-lg bg-app-panel p-3 hover:bg-app-hover transition-colors disabled:opacity-60"
                              >
                                <div className="text-sm text-app-text font-medium truncate">{collection.name}</div>
                                <div className="mt-1 text-[11px] text-app-muted">
                                  {savingCollectionId === collection.id ? 'Saving...' : 'Add this traffic as a new request'}
                                </div>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="h-full flex items-center justify-center text-app-muted text-sm">
                  Select a traffic row to inspect it.
                </div>
              )}
            </div>
          </Panel>
        </PanelGroup>
      )}
    </div>
  );
}
