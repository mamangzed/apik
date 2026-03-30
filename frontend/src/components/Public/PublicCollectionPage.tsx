import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Eye, EyeOff, Loader2, Plus, Send, Trash2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { apiClient } from '../../lib/apiClient';
import { sendRequestWithSmartTransport } from '../../lib/requestTransport';
import { ApiRequest, KeyValuePair, ProxyResponse, PublicCollectionResponse, RequestFormConfig, RequestFormFieldTarget } from '../../types';
import { METHOD_BG_COLORS } from '../../utils/format';
import PublicResponseViewer from './PublicResponseViewer';
import {
  applyFormToRequest,
  applyResponseMappings,
  getInitialFormValues,
  isFieldVisible,
  runFormScript,
} from '../../lib/requestForm';

const METHODS: ApiRequest['method'][] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
type EditTab = 'params' | 'headers' | 'body' | 'auth' | 'docs';
const EDIT_TABS: EditTab[] = ['params', 'headers', 'body', 'auth', 'docs'];

function createRow(): KeyValuePair {
  return {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    key: '',
    value: '',
    description: '',
    enabled: true,
  };
}

function cloneRequest(request: ApiRequest): ApiRequest {
  return {
    ...request,
    params: request.params.map((entry) => ({ ...entry })),
    headers: request.headers.map((entry) => ({ ...entry })),
    body: {
      ...request.body,
      formData: request.body.formData?.map((entry) => ({ ...entry })),
    },
    auth: { ...request.auth },
  };
}

function isBodyFieldTarget(target: RequestFormFieldTarget): boolean {
  return target === 'body-json' || target === 'body-form';
}

function toBodyOnlyFormConfig(config: RequestFormConfig | undefined): RequestFormConfig | undefined {
  if (!config) {
    return config;
  }

  const fields = (config.fields || []).filter((field) => isBodyFieldTarget(field.target));
  const allowedFieldIds = new Set(fields.map((field) => field.id));

  return {
    ...config,
    fields,
    responseMappings: (config.responseMappings || []).filter((mapping) => allowedFieldIds.has(mapping.targetFieldId)),
  };
}

function toBodyOnlyRequestForm(request: ApiRequest): ApiRequest {
  return {
    ...request,
    formConfig: toBodyOnlyFormConfig(request.formConfig),
  };
}

function MarkdownBlock({ content }: { content: string }) {
  const normalized = content
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '  ');

  return (
    <div className="text-sm text-app-muted max-w-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h1 className="text-2xl font-semibold text-app-text mt-3 mb-2">{children}</h1>,
          h2: ({ children }) => <h2 className="text-xl font-semibold text-app-text mt-3 mb-2">{children}</h2>,
          h3: ({ children }) => <h3 className="text-lg font-semibold text-app-text mt-3 mb-2">{children}</h3>,
          p: ({ children }) => <p className="my-2 leading-6 text-app-muted">{children}</p>,
          ul: ({ children }) => <ul className="list-disc ml-5 my-2 space-y-1">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal ml-5 my-2 space-y-1">{children}</ol>,
          li: ({ children }) => <li className="text-app-muted">{children}</li>,
          a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer" className="text-blue-300 underline">{children}</a>,
          code: ({ children }) => <code className="px-1 py-0.5 rounded bg-app-active text-emerald-300 font-mono text-xs">{children}</code>,
          pre: ({ children }) => <pre className="my-2 p-3 rounded bg-app-active overflow-x-auto">{children}</pre>,
          blockquote: ({ children }) => <blockquote className="border-l-2 border-app-accent pl-3 text-app-muted italic my-2">{children}</blockquote>,
          hr: () => <hr className="my-3 border-app-border" />,
        }}
      >
        {normalized}
      </ReactMarkdown>
    </div>
  );
}

function buildProxyPayload(request: ApiRequest, collection: PublicCollectionResponse) {
  const variables = collection.variables || [];
  const resolveText = (value: string) => value.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
    const found = variables.find((variable) => variable.key === key.trim() && variable.enabled);
    return found ? found.value : match;
  });

  const headers: Record<string, string> = {};
  request.headers.filter((header) => header.enabled && header.key).forEach((header) => {
    headers[resolveText(header.key)] = resolveText(header.value);
  });

  const searchParams = new URLSearchParams();
  request.params.filter((param) => param.enabled && param.key).forEach((param) => {
    searchParams.append(resolveText(param.key), resolveText(param.value));
  });

  let url = resolveText(request.url);
  const queryString = searchParams.toString();
  if (queryString) {
    url += (url.includes('?') ? '&' : '?') + queryString;
  }

  if (request.auth.type === 'bearer' && request.auth.token) {
    headers.Authorization = `Bearer ${resolveText(request.auth.token)}`;
  } else if (request.auth.type === 'basic' && request.auth.username) {
    headers.Authorization = `Basic ${btoa(`${request.auth.username}:${request.auth.password || ''}`)}`;
  } else if (request.auth.type === 'api-key' && request.auth.key) {
    const key = resolveText(request.auth.key);
    const value = resolveText(request.auth.value || '');
    if (request.auth.addTo === 'query') {
      try {
        const parsedUrl = new URL(url);
        parsedUrl.searchParams.set(key, value);
        url = parsedUrl.toString();
      } catch {
        const params = new URLSearchParams(url.includes('?') ? url.split('?')[1] : '');
        params.set(key, value);
        const base = url.split('?')[0];
        const nextQuery = params.toString();
        url = nextQuery ? `${base}?${nextQuery}` : base;
      }
    } else {
      headers[key] = value;
    }
  }

  let body: string | null = null;
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    if (request.body.type === 'json') {
      body = resolveText(request.body.content);
      if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
    } else if (request.body.type === 'xml') {
      body = request.body.content;
      if (!headers['Content-Type']) headers['Content-Type'] = 'application/xml';
    } else if (request.body.type === 'text') {
      body = request.body.content;
      if (!headers['Content-Type']) headers['Content-Type'] = 'text/plain';
    }
  }

  return { url, headers, body };
}

function parseAddressFormValue(raw: string): {
  street: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
} {
  const fallback = {
    street: '',
    city: '',
    state: '',
    postalCode: '',
    country: '',
  };

  if (!raw.trim()) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return fallback;
    }

    const data = parsed as Record<string, unknown>;
    return {
      street: String(data.street || ''),
      city: String(data.city || ''),
      state: String(data.state || ''),
      postalCode: String(data.postalCode || ''),
      country: String(data.country || ''),
    };
  } catch {
    return fallback;
  }
}

async function readFilesAsDataValue(files: FileList | null, multiple: boolean): Promise<string> {
  if (!files || files.length === 0) {
    return '';
  }

  const readFile = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });

  if (!multiple) {
    return readFile(files[0]);
  }

  const values = await Promise.all(Array.from(files).map(readFile));
  return JSON.stringify(values);
}

export default function PublicCollectionPage({ shareMode = 'collection' }: { shareMode?: 'collection' | 'form' }) {
  const { token } = useParams();
  const [collection, setCollection] = useState<PublicCollectionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const [responses, setResponses] = useState<Record<string, ProxyResponse>>({});
  const [hiddenRequests, setHiddenRequests] = useState<Set<string>>(new Set());
  const [editingRequests, setEditingRequests] = useState<Set<string>>(new Set());
  const [requestDrafts, setRequestDrafts] = useState<Record<string, ApiRequest>>({});
  const [activeEditTab, setActiveEditTab] = useState<Record<string, EditTab>>({});
  const [formValuesByRequest, setFormValuesByRequest] = useState<Record<string, Record<string, string>>>({});

  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const root = document.getElementById('root');

    const prevHtmlOverflow = html.style.overflow;
    const prevBodyOverflow = body.style.overflow;
    const prevRootOverflow = root?.style.overflow || '';
    const prevRootHeight = root?.style.height || '';

    html.style.overflow = 'auto';
    body.style.overflow = 'auto';
    if (root) {
      root.style.overflow = 'visible';
      root.style.height = 'auto';
    }

    return () => {
      html.style.overflow = prevHtmlOverflow;
      body.style.overflow = prevBodyOverflow;
      if (root) {
        root.style.overflow = prevRootOverflow;
        root.style.height = prevRootHeight;
      }
    };
  }, []);

  useEffect(() => {
    const blockContextMenu = (event: MouseEvent) => {
      event.preventDefault();
    };

    const handleShortcut = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const ctrlOrMeta = event.ctrlKey || event.metaKey;

      if (key === 'f5' || key === 'f12' || (event.altKey && (key === 'arrowleft' || key === 'arrowright'))) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        return;
      }

      if (ctrlOrMeta && event.shiftKey && (key === 'c' || key === 'i' || key === 'j')) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        return;
      }

      if (!ctrlOrMeta) {
        return;
      }

      if (key === 'a' || key === 'c' || key === 'x' || key === 'v' || key === 'z' || key === 'y') {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    };

    window.addEventListener('contextmenu', blockContextMenu);
    document.addEventListener('keydown', handleShortcut, true);

    return () => {
      window.removeEventListener('contextmenu', blockContextMenu);
      document.removeEventListener('keydown', handleShortcut, true);
    };
  }, []);

  useEffect(() => {
    const load = async () => {
      try {
        const endpoint = shareMode === 'form' ? 'forms' : 'collections';
        const { data } = await apiClient.get<PublicCollectionResponse>(`/public/${endpoint}/${token}`);
        setCollection(data);
        setFormValuesByRequest(() => {
          const next: Record<string, Record<string, string>> = {};
          data.requests.forEach((request) => {
            if (request.formConfig?.enabled) {
              next[request.id] = getInitialFormValues(toBodyOnlyRequestForm(request));
            }
          });
          return next;
        });
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : shareMode === 'form' ? 'Failed to load shared form' : 'Failed to load shared collection');
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [token, shareMode]);

  const updateFormValue = (requestId: string, fieldName: string, value: string) => {
    setFormValuesByRequest((previous) => ({
      ...previous,
      [requestId]: {
        ...(previous[requestId] || {}),
        [fieldName]: value,
      },
    }));
  };

  const toStringRecord = (value: unknown, fallback: Record<string, string>): Record<string, string> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return fallback;
    }

    const next: Record<string, string> = {};
    Object.entries(value as Record<string, unknown>).forEach(([key, item]) => {
      next[key] = item === null || item === undefined ? '' : String(item);
    });
    return next;
  };

  const sendRequest = async (request: ApiRequest) => {
    if (!collection) {
      return;
    }

    setActiveRequestId(request.id);
    try {
      let requestToSend = request;

      if (request.formConfig?.enabled) {
        const currentValues = formValuesByRequest[request.id] || getInitialFormValues(request);
        const mappedValues = applyResponseMappings(currentValues, request.formConfig, responses);
        const uiScriptValues = runFormScript<Record<string, string>>(
          request.formConfig.ui?.customScript,
          {
            values: { ...mappedValues },
            request,
            responses,
          },
          mappedValues,
        );
        const scriptedValues = runFormScript<Record<string, string>>(
          request.formConfig.scripts?.beforeSubmit,
          {
            values: { ...uiScriptValues },
            request,
            responses,
          },
          uiScriptValues,
        );
        const mergedValues = toStringRecord(scriptedValues, mappedValues);
        setFormValuesByRequest((previous) => ({
          ...previous,
          [request.id]: mergedValues,
        }));

        const applied = applyFormToRequest(request, mergedValues, responses);
        if (applied.error) {
          const errorMessage = applied.error || 'Form validation error';
          setResponses((previous) => ({
            ...previous,
            [request.id]: {
              status: 0,
              statusText: 'Form Validation Error',
              headers: {},
              body: errorMessage,
              size: errorMessage.length,
              time: 0,
              error: 'FORM_INVALID',
            },
          }));
          return;
        }

        requestToSend = applied.request;
      }

      const payload = buildProxyPayload(requestToSend, collection);
      const data = await sendRequestWithSmartTransport({
        method: requestToSend.method,
        url: payload.url,
        headers: payload.headers,
        body: payload.body,
        timeout: 30000,
      });

      if (request.formConfig?.enabled) {
        runFormScript(
          request.formConfig.scripts?.afterResponse,
          {
            response: data,
            request: requestToSend,
            values: formValuesByRequest[request.id] || {},
          },
          null,
        );
      }

      setResponses((previous) => ({ ...previous, [request.id]: data }));
    } catch (requestError) {
      setResponses((previous) => ({
        ...previous,
        [request.id]: {
          status: 0,
          statusText: 'Error',
          headers: {},
          body: requestError instanceof Error ? requestError.message : 'Request failed',
          size: 0,
          time: 0,
          error: 'REQUEST_FAILED',
        },
      }));
    } finally {
      setActiveRequestId(null);
    }
  };

  const toggleRequestEdit = (request: ApiRequest) => {
    setEditingRequests((previous) => {
      const next = new Set(previous);
      if (next.has(request.id)) {
        next.delete(request.id);
      } else {
        next.add(request.id);
      }
      return next;
    });

    setRequestDrafts((previous) => {
      if (previous[request.id]) {
        return previous;
      }
      return {
        ...previous,
        [request.id]: cloneRequest(request),
      };
    });

    setActiveEditTab((previous) => ({
      ...previous,
      [request.id]: previous[request.id] || 'params',
    }));
  };

  const updateRequestDraft = (request: ApiRequest, updates: Partial<ApiRequest>) => {
    setRequestDrafts((previous) => {
      const base = previous[request.id] || cloneRequest(request);

      return {
        ...previous,
        [request.id]: {
          ...base,
          ...updates,
          updatedAt: new Date().toISOString(),
        },
      };
    });
  };

  const resetRequestDraft = (request: ApiRequest) => {
    setRequestDrafts((previous) => ({
      ...previous,
      [request.id]: cloneRequest(request),
    }));
  };

  const updateKeyValueDraft = (
    request: ApiRequest,
    field: 'params' | 'headers',
    rowId: string,
    updates: Partial<KeyValuePair>,
  ) => {
    const draft = requestDrafts[request.id] || cloneRequest(request);
    const nextRows = draft[field].map((entry) => (entry.id === rowId ? { ...entry, ...updates } : entry));
    updateRequestDraft(request, { [field]: nextRows } as Partial<ApiRequest>);
  };

  const addKeyValueDraftRow = (request: ApiRequest, field: 'params' | 'headers') => {
    const draft = requestDrafts[request.id] || cloneRequest(request);
    updateRequestDraft(request, { [field]: [...draft[field], createRow()] } as Partial<ApiRequest>);
  };

  const removeKeyValueDraftRow = (request: ApiRequest, field: 'params' | 'headers', rowId: string) => {
    const draft = requestDrafts[request.id] || cloneRequest(request);
    updateRequestDraft(
      request,
      { [field]: draft[field].filter((entry) => entry.id !== rowId) } as Partial<ApiRequest>,
    );
  };

  const toggleRequestVisibility = (requestId: string) => {
    setHiddenRequests((previous) => {
      const next = new Set(previous);
      if (next.has(requestId)) {
        next.delete(requestId);
      } else {
        next.add(requestId);
      }
      return next;
    });
  };

  const hideAllRequests = () => {
    setHiddenRequests(new Set(collection?.requests.map((request) => request.id) || []));
  };

  const unhideAllRequests = () => {
    setHiddenRequests(new Set());
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-app-bg text-app-text flex flex-col items-center justify-center gap-3">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-app-accent"></div>
        <p className="text-sm text-app-muted">{shareMode === 'form' ? 'Loading shared form...' : 'Loading shared collection...'}</p>
      </div>
    );
  }

  if (error || !collection) {
    return (
      <div className="min-h-screen bg-app-bg text-app-text flex flex-col items-center justify-center gap-4">
        <div className="space-y-2 text-center max-w-sm">
          <p className="text-lg font-medium text-app-muted">
            {error ? 'Unable to Load Shared ' + (shareMode === 'form' ? 'Form' : 'Collection') : (shareMode === 'form' ? 'Form' : 'Collection') + ' Not Found'}
          </p>
          <p className="text-sm text-app-muted/70">
            {error || 'This ' + (shareMode === 'form' ? 'form' : 'collection') + ' may have been deleted or the link is invalid.'}
          </p>
        </div>
        <Link to="/" className="text-sm text-app-accent hover:underline">
          Return to app
        </Link>
      </div>
    );
  }

  const visibleRequests = shareMode === 'form'
    ? collection.requests.filter((request) => request.formConfig?.enabled)
    : collection.requests;

  return (
    <div className="min-h-screen bg-app-bg text-app-text">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-5 sm:space-y-6">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-app-muted hover:text-app-text">
          <ArrowLeft size={14} />
          Open app
        </Link>

        <div className="panel p-4 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-app-muted">{shareMode === 'form' ? 'Shared Form' : 'Shared Collection'}</p>
              <h1 className="text-2xl sm:text-3xl font-semibold mt-2 break-words">{collection.name}</h1>
              {collection.description && (
                <div className="mt-3 max-w-3xl">
                  <MarkdownBlock content={collection.description} />
                </div>
              )}
            </div>
            <div className="text-left sm:text-right text-xs text-app-muted">
              <div>{visibleRequests.length} requests</div>
              <div className="mt-1">{shareMode === 'form' ? 'Fill and submit form without login' : 'Try requests without login'}</div>
            </div>
          </div>
          {shareMode !== 'form' && (
            <div className="flex flex-wrap items-center gap-2 mt-5">
              <button onClick={hideAllRequests} className="btn-ghost text-xs inline-flex items-center gap-1.5">
                <EyeOff size={13} />
                Hide all requests
              </button>
              <button onClick={unhideAllRequests} className="btn-ghost text-xs inline-flex items-center gap-1.5">
                <Eye size={13} />
                Unhide all requests
              </button>
            </div>
          )}
        </div>

        <div className="space-y-4">
          {visibleRequests.map((request) => {
            const baseRequest = requestDrafts[request.id] || request;
            const effectiveRequest = shareMode === 'form' ? toBodyOnlyRequestForm(baseRequest) : baseRequest;
            const response = responses[request.id];
            const hidden = hiddenRequests.has(request.id);
            const editing = editingRequests.has(request.id);
            const currentEditTab = activeEditTab[request.id] || 'params';
            return (
              <div key={request.id} className="panel overflow-hidden">
                {effectiveRequest.formConfig?.ui?.customStyle && (
                  <style>{`
                    .public-form-${effectiveRequest.id} ${effectiveRequest.formConfig.ui.customStyle}
                  `}</style>
                )}
                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 px-4 sm:px-5 py-4 border-b border-app-border bg-app-sidebar">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className={`text-xs font-mono font-bold px-2.5 py-1 rounded ${METHOD_BG_COLORS[effectiveRequest.method]}`}>
                      {effectiveRequest.method}
                    </span>
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{effectiveRequest.name}</div>
                      <div className="text-xs text-app-muted truncate">{effectiveRequest.url}</div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {shareMode !== 'form' && (
                      <>
                        <button
                          onClick={() => toggleRequestEdit(request)}
                          className="btn-ghost text-xs"
                        >
                          {editing ? 'Done edit' : 'Edit request'}
                        </button>
                        <button
                          onClick={() => toggleRequestVisibility(request.id)}
                          className="btn-ghost text-xs inline-flex items-center gap-1.5"
                        >
                          {hidden ? <Eye size={13} /> : <EyeOff size={13} />}
                          {hidden ? 'Unhide' : 'Hide'}
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => sendRequest(effectiveRequest)}
                      className="btn-primary text-xs py-1.5 min-w-24 justify-center inline-flex items-center gap-1.5"
                      style={{ display: shareMode === 'form' && effectiveRequest.formConfig?.enabled ? 'none' : undefined }}
                    >
                      {activeRequestId === request.id ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                      {activeRequestId === request.id ? 'Sending' : 'Try request'}
                    </button>
                  </div>
                </div>

                {!hidden ? (
                  <div className="p-4 sm:p-5 space-y-4">
                  {shareMode !== 'form' && editing && (
                    <div className="border border-app-border rounded-lg overflow-hidden bg-app-bg/40">
                      <div className="px-3 py-2 border-b border-app-border bg-app-sidebar flex flex-col sm:flex-row sm:items-center gap-2">
                        <select
                          value={effectiveRequest.method}
                          onChange={(event) => updateRequestDraft(request, { method: event.target.value as ApiRequest['method'] })}
                          className="bg-app-panel border border-app-border rounded px-2 py-1.5 text-xs text-app-text font-mono"
                        >
                          {METHODS.map((method) => (
                            <option key={method} value={method}>{method}</option>
                          ))}
                        </select>
                        <input
                          value={effectiveRequest.url}
                          onChange={(event) => updateRequestDraft(request, { url: event.target.value })}
                          className="input-field text-xs font-mono w-full"
                          placeholder="https://api.example.com"
                        />
                      </div>

                      <div className="px-3 pt-2 border-b border-app-border">
                        <div className="flex items-center gap-4 overflow-x-auto">
                          {EDIT_TABS.map((tab) => (
                            <button
                              key={tab}
                              onClick={() => setActiveEditTab((previous) => ({ ...previous, [request.id]: tab }))}
                              className={`text-xs py-1.5 border-b-2 capitalize whitespace-nowrap ${
                                currentEditTab === tab
                                  ? 'border-app-accent text-app-text'
                                  : 'border-transparent text-app-muted hover:text-app-text'
                              }`}
                            >
                              {tab}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="p-3 space-y-3">
                        <p className="text-xs text-app-muted">
                          Edit here only affects this session and will not save to the original shared collection.
                        </p>

                        {currentEditTab === 'params' && (
                          <div className="space-y-2">
                            <div className="overflow-x-auto">
                              <div className="min-w-[640px] space-y-2">
                                <div className="grid grid-cols-[24px_1fr_1fr_1fr_42px] gap-2 text-[11px] text-app-muted uppercase tracking-wider px-1">
                                  <div />
                                  <div>Key</div>
                                  <div>Value</div>
                                  <div>Description</div>
                                  <div />
                                </div>
                                {effectiveRequest.params.map((param) => (
                                  <div key={param.id} className="grid grid-cols-[24px_1fr_1fr_1fr_42px] gap-2 items-center">
                                    <input
                                      type="checkbox"
                                      checked={param.enabled}
                                      onChange={(event) => updateKeyValueDraft(request, 'params', param.id, { enabled: event.target.checked })}
                                      className="w-3.5 h-3.5 accent-orange-500"
                                    />
                                    <input
                                      value={param.key}
                                      onChange={(event) => updateKeyValueDraft(request, 'params', param.id, { key: event.target.value })}
                                      className="input-field text-xs font-mono"
                                    />
                                    <input
                                      value={param.value}
                                      onChange={(event) => updateKeyValueDraft(request, 'params', param.id, { value: event.target.value })}
                                      className="input-field text-xs font-mono"
                                    />
                                    <input
                                      value={param.description || ''}
                                      onChange={(event) => updateKeyValueDraft(request, 'params', param.id, { description: event.target.value })}
                                      className="input-field text-xs"
                                    />
                                    <button onClick={() => removeKeyValueDraftRow(request, 'params', param.id)} className="btn-ghost p-1.5" title="Remove parameter">
                                      <Trash2 size={12} />
                                    </button>
                                  </div>
                                ))}
                              </div>
                            </div>
                            <button onClick={() => addKeyValueDraftRow(request, 'params')} className="btn-ghost text-xs inline-flex items-center gap-1.5">
                              <Plus size={12} /> Add parameter
                            </button>
                          </div>
                        )}

                        {currentEditTab === 'headers' && (
                          <div className="space-y-2">
                            <div className="overflow-x-auto">
                              <div className="min-w-[640px] space-y-2">
                                <div className="grid grid-cols-[24px_1fr_1fr_1fr_42px] gap-2 text-[11px] text-app-muted uppercase tracking-wider px-1">
                                  <div />
                                  <div>Key</div>
                                  <div>Value</div>
                                  <div>Description</div>
                                  <div />
                                </div>
                                {effectiveRequest.headers.map((header) => (
                                  <div key={header.id} className="grid grid-cols-[24px_1fr_1fr_1fr_42px] gap-2 items-center">
                                    <input
                                      type="checkbox"
                                      checked={header.enabled}
                                      onChange={(event) => updateKeyValueDraft(request, 'headers', header.id, { enabled: event.target.checked })}
                                      className="w-3.5 h-3.5 accent-orange-500"
                                    />
                                    <input
                                      value={header.key}
                                      onChange={(event) => updateKeyValueDraft(request, 'headers', header.id, { key: event.target.value })}
                                      className="input-field text-xs font-mono"
                                    />
                                    <input
                                      value={header.value}
                                      onChange={(event) => updateKeyValueDraft(request, 'headers', header.id, { value: event.target.value })}
                                      className="input-field text-xs font-mono"
                                    />
                                    <input
                                      value={header.description || ''}
                                      onChange={(event) => updateKeyValueDraft(request, 'headers', header.id, { description: event.target.value })}
                                      className="input-field text-xs"
                                    />
                                    <button onClick={() => removeKeyValueDraftRow(request, 'headers', header.id)} className="btn-ghost p-1.5" title="Remove header">
                                      <Trash2 size={12} />
                                    </button>
                                  </div>
                                ))}
                              </div>
                            </div>
                            <button onClick={() => addKeyValueDraftRow(request, 'headers')} className="btn-ghost text-xs inline-flex items-center gap-1.5">
                              <Plus size={12} /> Add header
                            </button>
                          </div>
                        )}

                        {currentEditTab === 'body' && (
                          <div className="space-y-2">
                            <div className="flex items-center gap-2">
                              <label className="text-xs text-app-muted">Body Type</label>
                              <select
                                value={effectiveRequest.body.type}
                                onChange={(event) =>
                                  updateRequestDraft(request, {
                                    body: { ...effectiveRequest.body, type: event.target.value as ApiRequest['body']['type'] },
                                  })
                                }
                                className="bg-app-panel border border-app-border rounded px-2 py-1 text-xs text-app-text"
                              >
                                <option value="none">none</option>
                                <option value="json">json</option>
                                <option value="text">text</option>
                                <option value="xml">xml</option>
                              </select>
                            </div>
                            {effectiveRequest.body.type !== 'none' && (
                              <textarea
                                value={effectiveRequest.body.content || ''}
                                onChange={(event) =>
                                  updateRequestDraft(request, {
                                    body: {
                                      ...effectiveRequest.body,
                                      content: event.target.value,
                                    },
                                  })
                                }
                                className="w-full min-h-28 bg-app-panel border border-app-border rounded p-2 text-xs font-mono text-app-text focus:outline-none focus:border-app-accent"
                                placeholder="Request body (temporary)"
                              />
                            )}
                          </div>
                        )}

                        {currentEditTab === 'auth' && (
                          <div className="space-y-2">
                            <div className="flex items-center gap-2">
                              <label className="text-xs text-app-muted">Auth Type</label>
                              <select
                                value={effectiveRequest.auth.type}
                                onChange={(event) =>
                                  updateRequestDraft(request, {
                                    auth: { ...effectiveRequest.auth, type: event.target.value as ApiRequest['auth']['type'] },
                                  })
                                }
                                className="bg-app-panel border border-app-border rounded px-2 py-1 text-xs text-app-text"
                              >
                                <option value="none">none</option>
                                <option value="bearer">bearer</option>
                                <option value="basic">basic</option>
                                <option value="api-key">api-key</option>
                              </select>
                            </div>
                            {effectiveRequest.auth.type === 'bearer' && (
                              <input
                                value={effectiveRequest.auth.token || ''}
                                onChange={(event) =>
                                  updateRequestDraft(request, {
                                    auth: { ...effectiveRequest.auth, token: event.target.value },
                                  })
                                }
                                className="input-field text-xs font-mono"
                                placeholder="Bearer token"
                              />
                            )}
                            {effectiveRequest.auth.type === 'basic' && (
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                <input
                                  value={effectiveRequest.auth.username || ''}
                                  onChange={(event) =>
                                    updateRequestDraft(request, {
                                      auth: { ...effectiveRequest.auth, username: event.target.value },
                                    })
                                  }
                                  className="input-field text-xs"
                                  placeholder="Username"
                                />
                                <input
                                  value={effectiveRequest.auth.password || ''}
                                  onChange={(event) =>
                                    updateRequestDraft(request, {
                                      auth: { ...effectiveRequest.auth, password: event.target.value },
                                    })
                                  }
                                  className="input-field text-xs"
                                  placeholder="Password"
                                  type="password"
                                />
                              </div>
                            )}
                            {effectiveRequest.auth.type === 'api-key' && (
                              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                                <input
                                  value={effectiveRequest.auth.key || ''}
                                  onChange={(event) =>
                                    updateRequestDraft(request, {
                                      auth: { ...effectiveRequest.auth, key: event.target.value },
                                    })
                                  }
                                  className="input-field text-xs"
                                  placeholder="Key"
                                />
                                <input
                                  value={effectiveRequest.auth.value || ''}
                                  onChange={(event) =>
                                    updateRequestDraft(request, {
                                      auth: { ...effectiveRequest.auth, value: event.target.value },
                                    })
                                  }
                                  className="input-field text-xs"
                                  placeholder="Value"
                                />
                                <select
                                  value={effectiveRequest.auth.addTo || 'header'}
                                  onChange={(event) =>
                                    updateRequestDraft(request, {
                                      auth: {
                                        ...effectiveRequest.auth,
                                        addTo: event.target.value as 'header' | 'query',
                                      },
                                    })
                                  }
                                  className="bg-app-panel border border-app-border rounded px-2 py-1 text-xs text-app-text"
                                >
                                  <option value="header">header</option>
                                  <option value="query">query</option>
                                </select>
                              </div>
                            )}
                          </div>
                        )}

                        {currentEditTab === 'docs' && (
                          <textarea
                            value={effectiveRequest.description || ''}
                            onChange={(event) => updateRequestDraft(request, { description: event.target.value })}
                            className="w-full min-h-24 bg-app-panel border border-app-border rounded p-2 text-xs text-app-text focus:outline-none focus:border-app-accent"
                            placeholder="Request docs (temporary)"
                          />
                        )}
                      </div>

                      <div className="px-3 py-2 border-t border-app-border bg-app-sidebar flex justify-end">
                        <button onClick={() => resetRequestDraft(request)} className="btn-ghost text-xs">
                          Reset changes
                        </button>
                      </div>
                    </div>
                  )}

                  {effectiveRequest.formConfig?.enabled && (
                    <div className={`public-form-${effectiveRequest.id} border border-app-border rounded-lg p-3 space-y-3 bg-app-bg/30`}>
                      <div>
                        <p className="form-title text-xs uppercase tracking-wider text-app-muted">
                          {effectiveRequest.formConfig.ui?.title || 'Interactive Form'}
                        </p>
                        <p className="form-subtitle text-xs text-app-muted mt-1">
                          {effectiveRequest.formConfig.ui?.subtitle || 'This request is configured with auto-generated/custom fields, response mapping, and optional auth dependency.'}
                        </p>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {Object.entries(
                          (effectiveRequest.formConfig.fields || []).reduce<Record<string, typeof effectiveRequest.formConfig.fields>>((acc, field) => {
                            const currentValues = formValuesByRequest[effectiveRequest.id] || {};
                            if (!isFieldVisible(field, currentValues)) {
                              return acc;
                            }

                            const group = (field.group || 'General').trim() || 'General';
                            if (!acc[group]) {
                              acc[group] = [];
                            }
                            acc[group].push(field);
                            return acc;
                          }, {}),
                        ).map(([groupName, groupedFields]) => (
                          <div key={`${effectiveRequest.id}-${groupName}`} className="md:col-span-2 border border-app-border rounded p-2 space-y-2">
                            <p className="text-[11px] uppercase tracking-wider text-app-muted">{groupName}</p>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                              {groupedFields.map((field) => {
                          const fieldValue = formValuesByRequest[effectiveRequest.id]?.[field.name] ?? field.defaultValue ?? '';
                          const sharedInputClass = 'input-field mt-1 text-xs';

                          return (
                            <label key={field.id} className={`text-xs text-app-muted block ${field.layoutWidth === 'full' ? 'md:col-span-2' : ''}`}>
                              <span className="inline-flex items-center gap-1">
                                {field.label}
                                {field.required && <span className="text-red-300">*</span>}
                              </span>
                              {field.type === 'textarea' ? (
                                <textarea
                                  value={fieldValue}
                                  onChange={(event) => updateFormValue(effectiveRequest.id, field.name, event.target.value)}
                                  placeholder={field.placeholder || ''}
                                  className={`${sharedInputClass} min-h-20`}
                                />
                              ) : field.repeatable ? (
                                <textarea
                                  value={fieldValue}
                                  onChange={(event) => updateFormValue(effectiveRequest.id, field.name, event.target.value)}
                                  placeholder={
                                    field.repeatSeparator === 'comma'
                                      ? 'value1,value2,value3'
                                      : field.repeatSeparator === 'json-lines'
                                        ? '{"id":1}\n{"id":2}'
                                        : 'one item per line'
                                  }
                                  className={`${sharedInputClass} min-h-20 font-mono`}
                                />
                              ) : field.type === 'json' ? (
                                <textarea
                                  value={fieldValue}
                                  onChange={(event) => updateFormValue(effectiveRequest.id, field.name, event.target.value)}
                                  placeholder='{"key":"value"}'
                                  className={`${sharedInputClass} min-h-20 font-mono`}
                                />
                              ) : field.type === 'address' ? (
                                <div className="mt-1 grid grid-cols-1 gap-1.5">
                                  {(() => {
                                    const address = parseAddressFormValue(fieldValue);
                                    const setAddressValue = (key: keyof typeof address, value: string) => {
                                      const next = { ...address, [key]: value };
                                      updateFormValue(effectiveRequest.id, field.name, JSON.stringify(next));
                                    };

                                    return (
                                      <>
                                        <input
                                          value={address.street}
                                          onChange={(event) => setAddressValue('street', event.target.value)}
                                          placeholder="Street"
                                          className={sharedInputClass}
                                        />
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                                          <input
                                            value={address.city}
                                            onChange={(event) => setAddressValue('city', event.target.value)}
                                            placeholder="City"
                                            className={sharedInputClass}
                                          />
                                          <input
                                            value={address.state}
                                            onChange={(event) => setAddressValue('state', event.target.value)}
                                            placeholder="State"
                                            className={sharedInputClass}
                                          />
                                        </div>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                                          <input
                                            value={address.postalCode}
                                            onChange={(event) => setAddressValue('postalCode', event.target.value)}
                                            placeholder="Postal code"
                                            className={sharedInputClass}
                                          />
                                          <input
                                            value={address.country}
                                            onChange={(event) => setAddressValue('country', event.target.value)}
                                            placeholder="Country"
                                            className={sharedInputClass}
                                          />
                                        </div>
                                      </>
                                    );
                                  })()}
                                </div>
                              ) : field.type === 'select' ? (
                                <select
                                  value={fieldValue}
                                  onChange={(event) => updateFormValue(effectiveRequest.id, field.name, event.target.value)}
                                  className={`${sharedInputClass} bg-app-panel`}
                                >
                                  <option value="">Select...</option>
                                  {(field.options || []).map((option) => (
                                    <option key={option.id} value={option.value}>{option.label || option.value}</option>
                                  ))}
                                </select>
                              ) : field.type === 'radio' ? (
                                <div className="mt-1 space-y-1.5">
                                  {(field.options || []).map((option) => (
                                    <label key={option.id} className="text-xs text-app-muted inline-flex items-center gap-2 mr-3">
                                      <input
                                        type="radio"
                                        name={`${effectiveRequest.id}_${field.name}`}
                                        value={option.value}
                                        checked={fieldValue === option.value}
                                        onChange={(event) => updateFormValue(effectiveRequest.id, field.name, event.target.value)}
                                        className="w-3.5 h-3.5 accent-orange-500"
                                      />
                                      {option.label || option.value}
                                    </label>
                                  ))}
                                </div>
                              ) : field.type === 'checkbox' ? (
                                <input
                                  type="checkbox"
                                  checked={fieldValue === 'true'}
                                  onChange={(event) => updateFormValue(effectiveRequest.id, field.name, event.target.checked ? 'true' : 'false')}
                                  className="mt-2 w-4 h-4 accent-orange-500"
                                />
                              ) : field.type === 'file' ? (
                                <input
                                  type="file"
                                  multiple={Boolean(field.multiple)}
                                  accept={field.accept || undefined}
                                  onChange={async (event) => {
                                    const encoded = await readFilesAsDataValue(event.target.files, Boolean(field.multiple));
                                    updateFormValue(effectiveRequest.id, field.name, encoded);
                                  }}
                                  className="mt-1 text-xs text-app-muted"
                                />
                              ) : field.type === 'range' ? (
                                <div className="mt-1 space-y-1">
                                  <input
                                    type="range"
                                    value={fieldValue || String(field.min ?? 0)}
                                    min={field.min}
                                    max={field.max}
                                    step={field.step}
                                    onChange={(event) => updateFormValue(effectiveRequest.id, field.name, event.target.value)}
                                    className="w-full accent-orange-500"
                                  />
                                  <div className="text-[11px] text-app-muted">Value: {fieldValue || String(field.min ?? 0)}</div>
                                </div>
                              ) : (
                                <input
                                  type={
                                    field.type === 'password'
                                      ? 'password'
                                      : field.type === 'number'
                                        ? 'number'
                                        : field.type === 'email'
                                          ? 'email'
                                          : field.type === 'tel'
                                            ? 'tel'
                                            : field.type === 'url'
                                              ? 'url'
                                              : field.type === 'date'
                                                ? 'date'
                                                : field.type === 'time'
                                                  ? 'time'
                                                  : field.type === 'datetime-local'
                                                    ? 'datetime-local'
                                                    : field.type === 'color'
                                                      ? 'color'
                                                      : 'text'
                                  }
                                  value={fieldValue}
                                  onChange={(event) => updateFormValue(effectiveRequest.id, field.name, event.target.value)}
                                  placeholder={field.placeholder || ''}
                                  min={field.min}
                                  max={field.max}
                                  step={field.step}
                                  pattern={field.pattern || undefined}
                                  className={sharedInputClass}
                                />
                              )}
                              {field.description && <span className="block mt-1 text-[11px] text-app-muted">{field.description}</span>}
                              <span className="block mt-1 text-[11px] text-app-muted font-mono">map: {field.target}{' -> '}{field.targetKey}</span>
                            </label>
                          );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>

                      {effectiveRequest.formConfig.authRequirement?.enabled && (
                        <div className="text-[11px] text-app-muted border border-app-border rounded px-2.5 py-2 bg-app-active/30">
                          Requires auth from another request first.
                        </div>
                      )}

                      <div className="flex flex-wrap gap-2 pt-1">
                        <button
                          onClick={() => sendRequest(effectiveRequest)}
                          className="form-submit btn-primary text-xs py-1.5 min-w-28 justify-center inline-flex items-center gap-1.5"
                        >
                          {activeRequestId === request.id ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                          {activeRequestId === request.id
                            ? 'Sending'
                            : (effectiveRequest.formConfig.ui?.submitLabel || 'Submit Form')}
                        </button>
                        {effectiveRequest.formConfig.ui?.showReset !== false && (
                          <button
                            onClick={() =>
                              setFormValuesByRequest((previous) => ({
                                ...previous,
                                [effectiveRequest.id]: getInitialFormValues(effectiveRequest),
                              }))
                            }
                            className="form-reset btn-ghost text-xs py-1.5 min-w-24"
                          >
                            {effectiveRequest.formConfig.ui?.resetLabel || 'Reset'}
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {effectiveRequest.description && <MarkdownBlock content={effectiveRequest.description} />}
                  {response && (
                    <PublicResponseViewer response={response} />
                  )}
                  </div>
                ) : (
                  <div className="px-5 py-4 text-xs text-app-muted bg-app-bg/30">Request is hidden. Click Unhide to show details and response.</div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}