import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Eye, EyeOff, Loader2, Plus, Send, Trash2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { apiClient } from '../../lib/apiClient';
import { sendRequestWithSmartTransport } from '../../lib/requestTransport';
import { ApiRequest, KeyValuePair, ProxyResponse, PublicCollectionResponse } from '../../types';
import { METHOD_BG_COLORS } from '../../utils/format';
import PublicResponseViewer from './PublicResponseViewer';

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

export default function PublicCollectionPage() {
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
        const { data } = await apiClient.get<PublicCollectionResponse>(`/public/collections/${token}`);
        setCollection(data);
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : 'Failed to load shared collection');
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [token]);

  const sendRequest = async (request: ApiRequest) => {
    if (!collection) {
      return;
    }

    setActiveRequestId(request.id);
    try {
      const payload = buildProxyPayload(request, collection);
      const data = await sendRequestWithSmartTransport({
        method: request.method,
        url: payload.url,
        headers: payload.headers,
        body: payload.body,
        timeout: 30000,
      });
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
    return <div className="min-h-screen bg-app-bg text-app-text flex items-center justify-center">Loading shared collection...</div>;
  }

  if (error || !collection) {
    return <div className="min-h-screen bg-app-bg text-app-text flex items-center justify-center">{error || 'Collection not found'}</div>;
  }

  return (
    <div className="min-h-screen bg-app-bg text-app-text">
      <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-app-muted hover:text-app-text">
          <ArrowLeft size={14} />
          Open app
        </Link>

        <div className="panel p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-app-muted">Shared Collection</p>
              <h1 className="text-3xl font-semibold mt-2">{collection.name}</h1>
              {collection.description && (
                <div className="mt-3 max-w-3xl">
                  <MarkdownBlock content={collection.description} />
                </div>
              )}
            </div>
            <div className="text-right text-xs text-app-muted">
              <div>{collection.requests.length} requests</div>
              <div className="mt-1">Try requests without login</div>
            </div>
          </div>
          <div className="flex items-center gap-2 mt-5">
            <button onClick={hideAllRequests} className="btn-ghost text-xs inline-flex items-center gap-1.5">
              <EyeOff size={13} />
              Hide all requests
            </button>
            <button onClick={unhideAllRequests} className="btn-ghost text-xs inline-flex items-center gap-1.5">
              <Eye size={13} />
              Unhide all requests
            </button>
          </div>
        </div>

        <div className="space-y-4">
          {collection.requests.map((request) => {
            const effectiveRequest = requestDrafts[request.id] || request;
            const response = responses[request.id];
            const hidden = hiddenRequests.has(request.id);
            const editing = editingRequests.has(request.id);
            const currentEditTab = activeEditTab[request.id] || 'params';
            return (
              <div key={request.id} className="panel overflow-hidden">
                <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-app-border bg-app-sidebar">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className={`text-xs font-mono font-bold px-2.5 py-1 rounded ${METHOD_BG_COLORS[effectiveRequest.method]}`}>
                      {effectiveRequest.method}
                    </span>
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{effectiveRequest.name}</div>
                      <div className="text-xs text-app-muted truncate">{effectiveRequest.url}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
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
                    <button onClick={() => sendRequest(effectiveRequest)} className="btn-primary text-xs py-1.5 min-w-24 justify-center inline-flex items-center gap-1.5">
                      {activeRequestId === request.id ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                      {activeRequestId === request.id ? 'Sending' : 'Try request'}
                    </button>
                  </div>
                </div>

                {!hidden ? (
                  <div className="p-5 space-y-4">
                  {editing && (
                    <div className="border border-app-border rounded-lg overflow-hidden bg-app-bg/40">
                      <div className="px-3 py-2 border-b border-app-border bg-app-sidebar flex items-center gap-2">
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
                          className="input-field text-xs font-mono"
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
                            <button onClick={() => addKeyValueDraftRow(request, 'params')} className="btn-ghost text-xs inline-flex items-center gap-1.5">
                              <Plus size={12} /> Add parameter
                            </button>
                          </div>
                        )}

                        {currentEditTab === 'headers' && (
                          <div className="space-y-2">
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
                              <div className="grid grid-cols-2 gap-2">
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
                              <div className="grid grid-cols-3 gap-2">
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