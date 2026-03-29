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
  Link2,
} from 'lucide-react';
import { useAppStore } from '../../store';
import { ApiRequest, HttpMethod, InterceptedRequest } from '../../types';
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
  const [mappingOpen, setMappingOpen] = useState(false);
  const [mappingValue, setMappingValue] = useState('');
  const [mappingMatches, setMappingMatches] = useState<MappingMatch[]>([]);
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
  const [targetCollectionId, setTargetCollectionId] = useState<string | null>(null);
  const [targetPlacement, setTargetPlacement] = useState<'header' | 'param' | 'body'>('header');
  const [targetKey, setTargetKey] = useState('');
  const [envKey, setEnvKey] = useState('');
  const [requestValueInput, setRequestValueInput] = useState('');
  const [responseValueInput, setResponseValueInput] = useState('');
  const [requestJsonKey, setRequestJsonKey] = useState('');
  const [responseJsonKey, setResponseJsonKey] = useState('');
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

  type MappingSource = 'response-header' | 'response-body';

  interface MappingMatch {
    id: string;
    request: InterceptedRequest;
    source: MappingSource;
    key?: string;
    jsonPath?: string;
    preview: string;
  }

  const normalizeEnvKey = (value: string) => value
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase() || 'mapped_value';

  const findJsonPath = (obj: unknown, needle: string, base = '$'): string | null => {
    if (obj == null) {
      return null;
    }
    if (typeof obj === 'string' || typeof obj === 'number' || typeof obj === 'boolean') {
      return String(obj) === needle ? base : null;
    }
    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i += 1) {
        const found = findJsonPath(obj[i], needle, `${base}[${i}]`);
        if (found) return found;
      }
      return null;
    }
    if (typeof obj === 'object') {
      for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        const found = findJsonPath(value, needle, `${base}.${key}`);
        if (found) return found;
      }
    }
    return null;
  };

  const detectJsonValueByKey = (obj: unknown, key: string, base = '$'): { path: string; value: string } | null => {
    if (!obj || typeof obj !== 'object') {
      return null;
    }
    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i += 1) {
        const found = detectJsonValueByKey(obj[i], key, `${base}[${i}]`);
        if (found) return found;
      }
      return null;
    }
    const record = obj as Record<string, unknown>;
    for (const [field, value] of Object.entries(record)) {
      if (field === key && value != null) {
        return { path: `${base}.${field}`, value: String(value) };
      }
      const nested = detectJsonValueByKey(value, key, `${base}.${field}`);
      if (nested) return nested;
    }
    return null;
  };

  const detectParamValue = (urlText: string, key: string): string | null => {
    try {
      const parsed = new URL(urlText);
      return parsed.searchParams.get(key);
    } catch {
      return null;
    }
  };

  const findMatchesForValue = (value: string, excludeId?: string): MappingMatch[] => {
    const trimmed = value.trim();
    if (!trimmed) return [];

    const matches: MappingMatch[] = [];
    const ordered = [...interceptedRequests].sort((a, b) => b.timestamp - a.timestamp);
    ordered.forEach((request) => {
      if (excludeId && request.id === excludeId) {
        return;
      }

      const headers = request.responseHeaders || {};
      Object.entries(headers).forEach(([key, headerValue]) => {
        const text = String(headerValue ?? '');
        if (text === trimmed || text.includes(trimmed)) {
          matches.push({
            id: `${request.id}-header-${key}`,
            request,
            source: 'response-header',
            key,
            preview: `${key}: ${text}`,
          });
        }
      });

      if (request.responseBody) {
        const bodyText = String(request.responseBody);
        if (bodyText.includes(trimmed)) {
          let jsonPath: string | null = null;
          try {
            const parsed = JSON.parse(bodyText);
            jsonPath = findJsonPath(parsed, trimmed);
          } catch {
            jsonPath = null;
          }
          matches.push({
            id: `${request.id}-body-${jsonPath || 'text'}`,
            request,
            source: 'response-body',
            jsonPath: jsonPath || undefined,
            preview: jsonPath ? `${jsonPath} = ${trimmed}` : `Body contains ${trimmed}`,
          });
        }
      }
    });

    return matches;
  };

  const openMappingModal = (value: string, options?: { placement?: 'header' | 'param' | 'body'; key?: string }) => {
    if (!selected) return;
    const matches = findMatchesForValue(value, selected.id);
    const defaultMatch = matches.find((match) => match.request.timestamp < selected.timestamp) || matches[0] || null;
    setMappingValue(value);
    setMappingMatches(matches);
    setSelectedMatchId(defaultMatch ? defaultMatch.id : null);
    const defaultKey = options?.key
      || Object.entries(selected.headers || {}).find(([, headerValue]) => String(headerValue) === value)?.[0]
      || defaultMatch?.key
      || '';
    const placement = options?.placement || 'header';
    setTargetPlacement(placement);
    setTargetKey(defaultKey);
    setEnvKey(normalizeEnvKey(defaultKey || value));
    setMappingOpen(true);
  };

  const handleContextMap = (
    event: React.MouseEvent,
    value: string,
    placement: 'header' | 'param' | 'body' = 'header',
    key?: string,
  ) => {
    event.preventDefault();
    openMappingModal(value, { placement, key });
  };

  const buildRequestFromIntercept = (request: InterceptedRequest, overrides?: Partial<InterceptedRequest>): Partial<ApiRequest> => {
    const base = overrides ? { ...request, ...overrides } : request;
    const contentType = (base.headers['content-type'] || base.headers['Content-Type'] || '').toLowerCase();
    const bodyType = base.body
      ? (contentType.includes('json')
        ? 'json'
        : contentType.includes('xml')
          ? 'xml'
          : contentType.includes('graphql')
            ? 'graphql'
            : 'text')
      : 'none';

    const headerEntries = Object.entries(base.headers || {}).map(([key, value], index) => ({
      id: `${base.id}-h-${index}`,
      key,
      value: String(value),
      enabled: true,
    }));

    let requestName = `${base.method} Request`;
    try {
      const parsed = new URL(base.url);
      requestName = `${base.method} ${parsed.pathname || '/'}`;
    } catch {
      requestName = `${base.method} ${safeHostname(base.url) || 'Request'}`;
    }

    return {
      name: requestName,
      method: (base.method || 'GET') as HttpMethod,
      url: base.url,
      headers: headerEntries,
      params: [],
      body: {
        type: bodyType,
        content: base.body || '',
      },
    };
  };

  const buildSourceScript = (match: MappingMatch, envName: string) => {
    if (match.source === 'response-header' && match.key) {
      return `const value = apik.response.header('${match.key}');\nif (value) apik.env.set('${envName}', String(value));`;
    }
    if (match.source === 'response-body' && match.jsonPath) {
      return `const json = apik.response.json();\nconst value = ${match.jsonPath.replace(/^\$\.?/, 'json.')};\nif (value != null) apik.env.set('${envName}', String(value));`;
    }
    return `const value = apik.response.text();\nif (value) apik.env.set('${envName}', String(value));`;
  };

  const applyTargetMapping = (
    request: ReturnType<typeof buildRequestFromIntercept>,
    envName: string,
    placement: 'header' | 'param' | 'body',
    key: string,
    value: string,
  ) => {
    const placeholder = `{{${envName}}}`;
    if (placement === 'header') {
      request.headers = request.headers || [];
      const existing = request.headers.find((header) => header.key === key);
      if (existing) {
        existing.value = placeholder;
      } else if (key) {
        request.headers.push({ id: `mapped-${key}`, key, value: placeholder, enabled: true });
      }
      return request;
    }
    if (placement === 'param') {
      request.params = request.params || [];
      const existing = request.params.find((param) => param.key === key);
      if (existing) {
        existing.value = placeholder;
      } else if (key) {
        request.params.push({ id: `mapped-${key}`, key, value: placeholder, enabled: true });
      }
      return request;
    }
    if (placement === 'body') {
      const currentBody = request.body || { type: 'text' as const, content: '' };
      const currentContent = currentBody.content || '';
      request.body = {
        ...currentBody,
        type: currentBody.type || 'text',
        content: currentContent.includes(value)
          ? currentContent.split(value).join(placeholder)
          : currentContent,
      };
      return request;
    }
    return request;
  };

  const handleAddFlowToCollection = async () => {
    if (!selected || !targetCollectionId || !mappingValue.trim()) {
      return;
    }
    const match = mappingMatches.find((item) => item.id === selectedMatchId) || null;
    if (!match) {
      toast.error('Select a source match first');
      return;
    }

    const envName = normalizeEnvKey(envKey || targetKey || mappingValue);
    const sourceRequest = buildRequestFromIntercept(match.request);
    const targetRequest = buildRequestFromIntercept(selected);

    sourceRequest.testScript = sourceRequest.testScript
      ? `${sourceRequest.testScript}\n\n${buildSourceScript(match, envName)}`
      : buildSourceScript(match, envName);

    applyTargetMapping(targetRequest, envName, targetPlacement, targetKey, mappingValue);

    try {
      setSavingCollectionId(targetCollectionId);
      await addRequestToCollection(targetCollectionId, {
        ...sourceRequest,
        name: `1. ${sourceRequest.name}`,
      });
      await addRequestToCollection(targetCollectionId, {
        ...targetRequest,
        name: `2. ${targetRequest.name}`,
        preRequestScript: targetRequest.preRequestScript || '',
      });
      toast.success('Flow added to collection');
      setMappingOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to add flow');
    } finally {
      setSavingCollectionId(null);
    }
  };

  const resolveAutoCollectionId = () => {
    if (targetCollectionId) {
      return targetCollectionId;
    }
    if (collections.length === 1) {
      return collections[0].id;
    }
    return null;
  };

  const pickBestMatch = (matches: MappingMatch[], current: InterceptedRequest) => {
    if (matches.length === 0) {
      return null;
    }
    const earlier = matches.filter((match) => match.request.timestamp < current.timestamp);
    if (earlier.length > 0) {
      return earlier.sort((a, b) => b.request.timestamp - a.request.timestamp)[0];
    }
    return matches[0];
  };

  const handleAutoFlow = async (value: string, key?: string, placementOverride?: 'header' | 'param' | 'body') => {
    if (!selected) {
      return;
    }
    let trimmed = value.trim();
    let detectedKey = key || '';

    if (!trimmed && detectedKey) {
      const fromParam = detectParamValue(selected.url, detectedKey);
      if (fromParam) {
        trimmed = fromParam;
      }
      if (!trimmed && editedBody) {
        try {
          const parsed = JSON.parse(editedBody);
          const found = detectJsonValueByKey(parsed, detectedKey);
          if (found) {
            trimmed = found.value;
          }
        } catch {
          // ignore
        }
      }
    }

    if (!trimmed) {
      toast.error('Value is empty');
      return;
    }

    const matches = findMatchesForValue(trimmed, selected.id);
    const match = pickBestMatch(matches, selected);
    if (!match) {
      toast.error('No source match found for this value');
      return;
    }

    const collectionId = resolveAutoCollectionId();
    if (!collectionId) {
      setMappingValue(trimmed);
      setMappingMatches(matches);
      setSelectedMatchId(match.id);
      setTargetPlacement(key ? 'header' : 'body');
      setTargetKey(key || '');
      setEnvKey(normalizeEnvKey(key || trimmed));
      setMappingOpen(true);
      toast('Select a collection to finalize the flow');
      return;
    }

    const envName = normalizeEnvKey(detectedKey || trimmed);
    const sourceRequest = buildRequestFromIntercept(match.request);
    const targetRequest = buildRequestFromIntercept(selected);

    sourceRequest.testScript = sourceRequest.testScript
      ? `${sourceRequest.testScript}\n\n${buildSourceScript(match, envName)}`
      : buildSourceScript(match, envName);

    const placement: 'header' | 'body' | 'param' = placementOverride || (detectedKey ? 'header' : 'body');
    applyTargetMapping(targetRequest, envName, placement, detectedKey || '', trimmed);

    try {
      setSavingCollectionId(collectionId);
      await addRequestToCollection(collectionId, {
        ...sourceRequest,
        name: `1. ${sourceRequest.name}`,
      });
      await addRequestToCollection(collectionId, {
        ...targetRequest,
        name: `2. ${targetRequest.name}`,
        preRequestScript: targetRequest.preRequestScript || '',
      });
      toast.success('Auto flow added to collection');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to add flow');
    } finally {
      setSavingCollectionId(null);
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
    setRequestValueInput('');
    setResponseValueInput('');
    setRequestJsonKey('');
    setResponseJsonKey('');
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

  const parseEditedHeaders = (): Record<string, string> => {
    try {
      const parsed = JSON.parse(editedHeaders || '{}');
      if (parsed && typeof parsed === 'object') {
        return Object.entries(parsed as Record<string, unknown>).reduce<Record<string, string>>((acc, [key, value]) => {
          acc[key] = String(value ?? '');
          return acc;
        }, {});
      }
    } catch {
      // Ignore parse errors.
    }
    return {};
  };

  const getUrlParams = (urlText: string) => {
    try {
      const parsed = new URL(urlText);
      return Array.from(parsed.searchParams.entries());
    } catch {
      return [] as Array<[string, string]>;
    }
  };

  const listJsonKeys = (text: string) => {
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return Object.entries(parsed as Record<string, unknown>)
          .filter(([key]) => typeof key === 'string')
          .map(([key, value]) => ({ key, value: String(value ?? '') }));
      }
    } catch {
      // ignore parse errors
    }
    return [] as Array<{ key: string; value: string }>;
  };

  const getEditorSelectionText = (editor: { getSelection: () => unknown; getModel: () => unknown; getPosition: () => unknown }) => {
    const selection = editor.getSelection() as { isEmpty?: () => boolean; } | null;
    const model = editor.getModel() as { getValueInRange: (range: unknown) => string; getWordAtPosition: (pos: unknown) => { word: string } | null } | null;
    if (!model) {
      return '';
    }
    if (selection && typeof selection.isEmpty === 'function' && !selection.isEmpty()) {
      return model.getValueInRange(selection);
    }
    const position = editor.getPosition();
    const word = model.getWordAtPosition(position);
    return word?.word || '';
  };

  const registerEditorMappingActions = (
    editor: { addAction: (action: { id: string; label: string; contextMenuGroupId?: string; contextMenuOrder?: number; run: () => void; }) => void },
    placement: 'body',
  ) => {
    editor.addAction({
      id: `apik-map-selection-${placement}`,
      label: 'Map selection',
      contextMenuGroupId: 'navigation',
      contextMenuOrder: 1.3,
      run: () => {
        const value = getEditorSelectionText(editor as unknown as { getSelection: () => unknown; getModel: () => unknown; getPosition: () => unknown; });
        if (value) {
          openMappingModal(value, { placement });
        } else {
          toast('Select text to map');
        }
      },
    });
    editor.addAction({
      id: `apik-auto-flow-${placement}`,
      label: 'Auto flow from selection',
      contextMenuGroupId: 'navigation',
      contextMenuOrder: 1.4,
      run: () => {
        const value = getEditorSelectionText(editor as unknown as { getSelection: () => unknown; getModel: () => unknown; getPosition: () => unknown; });
        if (value) {
          void handleAutoFlow(value);
        } else {
          toast('Select text to map');
        }
      },
    });
  };

  const responseBodyToRender = beautifiedResponseBody ?? selected?.responseBody ?? '';
  const parsedRequestHeaders = parseEditedHeaders();
  const requestJsonKeys = listJsonKeys(editedBody || '');
  const responseJsonKeys = listJsonKeys(selected?.responseBody || '');

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
    <>
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
                        <p
                          className="text-sm font-mono text-app-text truncate"
                          onContextMenu={(event) => {
                            event.preventDefault();
                            const params = getUrlParams(selected.url);
                            if (params.length === 0) {
                              toast('No query params to map');
                              return;
                            }
                            const [paramKey, paramValue] = params[0];
                            openMappingModal(paramValue, { placement: 'param', key: paramKey });
                          }}
                          title="Right click to map query param"
                        >
                          {selected.url}
                        </p>
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
                              onMount={(editor) => registerEditorMappingActions(editor, 'body')}
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
                          <div className="px-3 py-2 border-b border-app-border bg-app-panel text-xs text-app-muted flex items-center gap-2">
                            <span className="text-[11px] uppercase tracking-wider">Query Params</span>
                            <button
                              onClick={() => {
                                try {
                                  const url = new URL(selected.url);
                                  const entries = Array.from(url.searchParams.entries());
                                  if (entries.length === 0) {
                                    toast('No query params');
                                    return;
                                  }
                                  const [paramKey, paramValue] = entries[0];
                                  openMappingModal(paramValue, { placement: 'param', key: paramKey });
                                } catch {
                                  toast('Invalid URL');
                                }
                              }}
                              className="text-[11px] px-2 py-0.5 rounded border border-app-border text-app-muted hover:text-app-text hover:bg-app-hover"
                            >
                              Map first param
                            </button>
                          </div>
                          <div className="h-[140px] overflow-y-auto border-b border-app-border">
                            {Object.keys(parsedRequestHeaders).length === 0 ? (
                              <div className="p-3 text-sm text-app-muted">No request headers parsed.</div>
                            ) : (
                              Object.entries(parsedRequestHeaders).map(([key, value]) => (
                                <div
                                  key={key}
                                  className="flex items-start gap-2 px-3 py-2 border-b border-app-border/60 text-xs"
                                  onContextMenu={(event) => handleContextMap(event, value, 'header', key)}
                                  title="Right click to map"
                                >
                                  <div className="flex-1 text-blue-300 font-mono break-all">{key}</div>
                                  <div className="flex-[1.2] text-app-text font-mono break-all">{value}</div>
                                  <button
                                    onClick={() => openMappingModal(value)}
                                    className="flex items-center gap-1 px-2 py-0.5 rounded border border-app-border text-app-muted hover:text-app-text hover:bg-app-hover"
                                    title="Map this value"
                                  >
                                    <Link2 size={11} /> Map
                                  </button>
                                  <button
                                    onClick={() => void handleAutoFlow(value, key)}
                                    className="flex items-center gap-1 px-2 py-0.5 rounded border border-app-border text-app-muted hover:text-app-text hover:bg-app-hover"
                                    title="Auto-generate flow"
                                  >
                                    <Zap size={11} /> Auto
                                  </button>
                                </div>
                              ))
                            )}
                          </div>
                          <Editor
                            height="calc(100% - 173px)"
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
                          <div className="px-3 py-2 border-b border-app-border bg-app-sidebar text-xs text-app-muted uppercase tracking-wider flex items-center justify-between">
                            <span>Request Body</span>
                            <div className="flex items-center gap-2 normal-case">
                              {requestJsonKeys.length > 0 && (
                                <select
                                  value={requestJsonKey}
                                  onChange={(event) => setRequestJsonKey(event.target.value)}
                                  className="input-field text-xs px-2 py-1"
                                >
                                  <option value="">Select JSON key</option>
                                  {requestJsonKeys.map((entry) => (
                                    <option key={entry.key} value={entry.key}>{entry.key}</option>
                                  ))}
                                </select>
                              )}
                              {requestJsonKey && (
                                <>
                                  <button
                                    onClick={() => {
                                      const entry = requestJsonKeys.find((item) => item.key === requestJsonKey);
                                      if (!entry) return;
                                      openMappingModal(entry.value, { placement: 'body', key: requestJsonKey });
                                    }}
                                    className="flex items-center gap-1 px-2 py-1 text-xs rounded border border-app-border text-app-muted hover:text-app-text hover:bg-app-hover"
                                  >
                                    <Link2 size={11} /> Map key
                                  </button>
                                  <button
                                    onClick={() => {
                                      const entry = requestJsonKeys.find((item) => item.key === requestJsonKey);
                                      if (!entry) return;
                                      void handleAutoFlow(entry.value, requestJsonKey, 'body');
                                    }}
                                    className="flex items-center gap-1 px-2 py-1 text-xs rounded border border-app-border text-app-muted hover:text-app-text hover:bg-app-hover"
                                  >
                                    <Zap size={11} /> Auto key
                                  </button>
                                </>
                              )}
                              <input
                                value={requestValueInput}
                                onChange={(event) => setRequestValueInput(event.target.value)}
                                onContextMenu={(event) => handleContextMap(event, requestValueInput, 'body')}
                                className="input-field text-xs px-2 py-1"
                                placeholder="Value to map"
                              />
                              <button
                                onClick={() => openMappingModal(requestValueInput)}
                                className="flex items-center gap-1 px-2 py-1 text-xs rounded border border-app-border text-app-muted hover:text-app-text hover:bg-app-hover"
                              >
                                <Link2 size={11} /> Map
                              </button>
                              <button
                                onClick={() => void handleAutoFlow(requestValueInput)}
                                className="flex items-center gap-1 px-2 py-1 text-xs rounded border border-app-border text-app-muted hover:text-app-text hover:bg-app-hover"
                              >
                                <Zap size={11} /> Auto
                              </button>
                            </div>
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
                            onMount={(editor) => registerEditorMappingActions(editor, 'body')}
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
                          <div className="px-3 py-2 border-b border-app-border bg-app-sidebar text-xs text-app-muted uppercase tracking-wider flex items-center justify-between">
                            <span>Response Headers</span>
                            <button
                              onClick={() => {
                                if (!selected.responseHeaders) return;
                                const json = JSON.stringify(selected.responseHeaders, null, 2);
                                void copyText(json);
                                toast.success('Response headers copied');
                              }}
                              className="flex items-center gap-1 px-2 py-1 text-[11px] rounded border border-app-border text-app-muted hover:text-app-text hover:bg-app-hover"
                            >
                              <Copy size={11} /> Copy
                            </button>
                          </div>
                          <div className="h-full overflow-y-auto">
                            {Object.entries(selected.responseHeaders || {}).length === 0 ? (
                              <div className="p-4 text-app-muted text-sm">No response headers captured yet.</div>
                            ) : (
                              Object.entries(selected.responseHeaders || {}).map(([key, value]) => (
                                <div
                                  key={key}
                                  className="flex items-start gap-2 px-3 py-2 border-b border-app-border/60 text-xs"
                                  onContextMenu={(event) => handleContextMap(event, String(value), 'header', key)}
                                  title="Right click to map"
                                >
                                  <div className="flex-1 text-blue-300 font-mono break-all">{key}</div>
                                  <div className="flex-[1.2] text-app-text font-mono break-all">{String(value)}</div>
                                  <button
                                    onClick={() => openMappingModal(String(value))}
                                    className="flex items-center gap-1 px-2 py-0.5 rounded border border-app-border text-app-muted hover:text-app-text hover:bg-app-hover"
                                    title="Map this value"
                                  >
                                    <Link2 size={11} /> Map
                                  </button>
                                  <button
                                    onClick={() => void handleAutoFlow(String(value), key)}
                                    className="flex items-center gap-1 px-2 py-0.5 rounded border border-app-border text-app-muted hover:text-app-text hover:bg-app-hover"
                                    title="Auto-generate flow"
                                  >
                                    <Zap size={11} /> Auto
                                  </button>
                                </div>
                              ))
                            )}
                          </div>
                        </div>
                        <div className="overflow-hidden">
                          <div className="px-3 py-2 border-b border-app-border bg-app-sidebar text-xs text-app-muted uppercase tracking-wider flex items-center justify-between">
                            <span>Response Body</span>
                            <div className="flex items-center gap-2 normal-case">
                              {typeof selected.responseStatusCode === 'number' ? (
                                <span className="text-app-text">HTTP {selected.responseStatusCode}</span>
                              ) : null}
                              {responseJsonKeys.length > 0 && (
                                <select
                                  value={responseJsonKey}
                                  onChange={(event) => setResponseJsonKey(event.target.value)}
                                  className="input-field text-xs px-2 py-1"
                                >
                                  <option value="">Select JSON key</option>
                                  {responseJsonKeys.map((entry) => (
                                    <option key={entry.key} value={entry.key}>{entry.key}</option>
                                  ))}
                                </select>
                              )}
                              {responseJsonKey && (
                                <>
                                  <button
                                    onClick={() => {
                                      const entry = responseJsonKeys.find((item) => item.key === responseJsonKey);
                                      if (!entry) return;
                                      openMappingModal(entry.value, { placement: 'body', key: responseJsonKey });
                                    }}
                                    className="flex items-center gap-1 px-2 py-1 text-xs rounded border border-app-border text-app-muted hover:text-app-text hover:bg-app-hover"
                                  >
                                    <Link2 size={11} /> Map key
                                  </button>
                                  <button
                                    onClick={() => {
                                      const entry = responseJsonKeys.find((item) => item.key === responseJsonKey);
                                      if (!entry) return;
                                      void handleAutoFlow(entry.value, responseJsonKey, 'body');
                                    }}
                                    className="flex items-center gap-1 px-2 py-1 text-xs rounded border border-app-border text-app-muted hover:text-app-text hover:bg-app-hover"
                                  >
                                    <Zap size={11} /> Auto key
                                  </button>
                                </>
                              )}
                              <input
                                value={responseValueInput}
                                onChange={(event) => setResponseValueInput(event.target.value)}
                                onContextMenu={(event) => handleContextMap(event, responseValueInput, 'body')}
                                className="input-field text-xs px-2 py-1"
                                placeholder="Value to map"
                              />
                              <button
                                onClick={() => openMappingModal(responseValueInput)}
                                className="flex items-center gap-1 px-2 py-1 text-xs rounded border border-app-border text-app-muted hover:text-app-text hover:bg-app-hover"
                              >
                                <Link2 size={11} /> Map
                              </button>
                              <button
                                onClick={() => void handleAutoFlow(responseValueInput)}
                                className="flex items-center gap-1 px-2 py-1 text-xs rounded border border-app-border text-app-muted hover:text-app-text hover:bg-app-hover"
                              >
                                <Zap size={11} /> Auto
                              </button>
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
                              onMount={(editor) => registerEditorMappingActions(editor, 'body')}
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
    {mappingOpen && (
      <div className="fixed inset-0 z-[80] bg-black/60 flex items-center justify-center p-4">
        <div className="w-full max-w-3xl bg-app-panel border border-app-border rounded-lg shadow-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-app-border bg-app-sidebar flex items-center justify-between">
            <h3 className="text-sm font-semibold text-app-text">Request Flow Mapper</h3>
            <button
              onClick={() => setMappingOpen(false)}
              className="p-1 rounded hover:bg-app-hover text-app-muted hover:text-app-text"
            >
              <XIcon size={14} />
            </button>
          </div>
          <div className="p-4 space-y-4">
            <div className="space-y-2">
              <label className="text-xs text-app-muted uppercase tracking-wider">Value to map</label>
              <div className="flex items-center gap-2">
                <input
                  value={mappingValue}
                  onChange={(event) => setMappingValue(event.target.value)}
                  className="input-field flex-1"
                  placeholder="Paste value from intercept"
                />
                <button
                  onClick={() => {
                    const matches = findMatchesForValue(mappingValue, selected?.id);
                    setMappingMatches(matches);
                    const defaultMatch = matches[0] || null;
                    setSelectedMatchId(defaultMatch ? defaultMatch.id : null);
                  }}
                  className="px-3 py-1.5 text-sm rounded border border-app-border text-app-muted hover:text-app-text hover:bg-app-hover"
                >
                  Find source
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_0.8fr] gap-4">
              <div className="space-y-2">
                <div className="text-xs text-app-muted uppercase tracking-wider">Source matches</div>
                <div className="border border-app-border rounded bg-app-bg max-h-48 overflow-y-auto">
                  {mappingMatches.length === 0 ? (
                    <div className="p-3 text-sm text-app-muted">No matches found yet.</div>
                  ) : (
                    mappingMatches.map((match) => (
                      <label
                        key={match.id}
                        className="flex items-start gap-2 px-3 py-2 border-b border-app-border/50 text-xs text-app-muted cursor-pointer"
                      >
                        <input
                          type="radio"
                          checked={selectedMatchId === match.id}
                          onChange={() => {
                            setSelectedMatchId(match.id);
                            if (match.key && !targetKey) {
                              setTargetKey(match.key);
                            }
                          }}
                          className="mt-1 accent-orange-500"
                        />
                        <div>
                          <div className="text-app-text font-medium">
                            {match.request.method} {safeHostname(match.request.url)}
                          </div>
                          <div>{match.preview}</div>
                        </div>
                      </label>
                    ))
                  )}
                </div>
              </div>
              <div className="space-y-3">
                <div className="space-y-2">
                  <label className="text-xs text-app-muted uppercase tracking-wider">Target Collection</label>
                  <select
                    value={targetCollectionId || ''}
                    onChange={(event) => setTargetCollectionId(event.target.value || null)}
                    className="input-field"
                  >
                    <option value="">Select collection...</option>
                    {collections.map((collection) => (
                      <option key={collection.id} value={collection.id}>{collection.name}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs text-app-muted uppercase tracking-wider">Target placement</label>
                  <div className="flex items-center gap-2">
                    {(['header', 'param', 'body'] as const).map((type) => (
                      <button
                        key={type}
                        onClick={() => setTargetPlacement(type)}
                        className={`px-2.5 py-1 rounded text-xs border ${
                          targetPlacement === type
                            ? 'border-app-accent bg-app-active text-app-text'
                            : 'border-app-border text-app-muted hover:text-app-text hover:bg-app-hover'
                        }`}
                      >
                        {type}
                      </button>
                    ))}
                  </div>
                </div>
                {targetPlacement !== 'body' && (
                  <div className="space-y-2">
                    <label className="text-xs text-app-muted uppercase tracking-wider">Target key</label>
                    <input
                      value={targetKey}
                      onChange={(event) => setTargetKey(event.target.value)}
                      className="input-field"
                      placeholder="e.g. x-unique-id"
                    />
                  </div>
                )}
                <div className="space-y-2">
                  <label className="text-xs text-app-muted uppercase tracking-wider">Environment key</label>
                  <input
                    value={envKey}
                    onChange={(event) => setEnvKey(event.target.value)}
                    className="input-field"
                    placeholder="e.g. x_unique_id"
                  />
                </div>
              </div>
            </div>
          </div>
          <div className="px-4 py-3 border-t border-app-border bg-app-sidebar flex items-center justify-end gap-2">
            <button
              onClick={() => setMappingOpen(false)}
              className="px-3 py-1.5 text-sm rounded border border-app-border text-app-muted hover:text-app-text hover:bg-app-hover"
            >
              Cancel
            </button>
            <button
              onClick={handleAddFlowToCollection}
              disabled={!targetCollectionId || !selectedMatchId || !mappingValue.trim()}
              className="px-3 py-1.5 text-sm rounded bg-app-accent text-white hover:bg-app-accent-hover disabled:opacity-60"
            >
              Add flow to collection
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
