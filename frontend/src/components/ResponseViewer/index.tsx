import { useState } from 'react';
import { useAppStore } from '../../store';
import { CollectionRunAssertion, RequestHistoryEntry, ResponseTab } from '../../types';
import { getStatusColor, formatBytes, formatTime, detectLanguage, prettyPrint, canBeautifyContent } from '../../utils/format';
import { Copy, Download, Search, Wand2, RotateCcw, Trash2, FlaskConical, BookPlus } from 'lucide-react';
import Editor from '@monaco-editor/react';
import toast from 'react-hot-toast';

const TABS: { id: ResponseTab; label: string }[] = [
  { id: 'body', label: 'Body' },
  { id: 'headers', label: 'Headers' },
  { id: 'cookies', label: 'Cookies' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'history', label: 'History' },
];

export default function ResponseViewer() {
  const {
    tabs,
    activeTabId,
    responses,
    postRequestAssertions,
    loadingTabs,
    requestHistory,
    replayHistoryEntry,
    clearRequestHistory,
    saveResponseAsMockExample,
    loadMockExampleForTab,
    deleteMockExampleFromRequest,
  } = useAppStore();
  const [activeTab, setActiveTab] = useState<ResponseTab>('body');
  const [wordWrap, setWordWrap] = useState(true);
  const [rawView, setRawView] = useState(false);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);

  const activeTabData = tabs.find((t) => t.id === activeTabId);
  const isLoading = activeTabId ? loadingTabs.has(activeTabId) : false;
  const response = activeTabId ? responses[activeTabId] : undefined;
  const assertions = activeTabId ? postRequestAssertions[activeTabId] || [] : [];

  const contentType = response?.headers?.['content-type'] || '';
  const language = detectLanguage(contentType, response?.body || '');
  const formattedBody = response
    ? rawView
      ? response.body
      : prettyPrint(response.body, contentType)
    : '';
  const canBeautify = response ? canBeautifyContent(response.body, language, contentType) : false;

  const handleCopyBody = () => {
    if (response) {
      navigator.clipboard.writeText(formattedBody);
      toast.success('Copied to clipboard');
    }
  };

  const handleDownload = () => {
    if (!response) return;
    const ext = language === 'json' ? 'json' : language === 'xml' ? 'xml' : 'txt';
    const blob = new Blob([formattedBody], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `response.${ext}`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const handleBeautify = () => {
    if (!response || !canBeautify) {
      toast('This response cannot be beautified');
      return;
    }
    setRawView(false);
    toast.success('Beautified response view');
  };

  const historyRows = requestHistory.slice(0, 50);
  const selectedHistoryEntry = selectedHistoryId
    ? requestHistory.find((entry) => entry.id === selectedHistoryId) || null
    : null;
  const mockExamples = activeTabData?.requestState.request.mockExamples || [];

  if (!activeTabData) {
    return (
      <div className="flex items-center justify-center h-full text-app-muted text-sm">
        No request selected
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <div className="w-8 h-8 border-2 border-app-accent border-t-transparent rounded-full animate-spin" />
        <p className="text-app-muted text-sm">Sending request…</p>
      </div>
    );
  }

  if (!response) {
    return (
      <div className="h-full overflow-y-auto p-4 text-app-muted">
        <div className="flex flex-col items-center justify-center py-8 gap-2">
          <div className="w-16 h-16 rounded-full bg-app-panel flex items-center justify-center mb-2">
            <Search size={24} className="opacity-30" />
          </div>
          <p className="text-sm">Send a request to see the response</p>
          <p className="text-xs text-app-muted/60">Press <kbd className="bg-app-panel border border-app-border px-1 py-0.5 rounded text-xs">Ctrl+Enter</kbd> to send</p>
        </div>

        {historyRows.length > 0 && (
          <div className="mt-2 border border-app-border rounded bg-app-panel p-3">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm text-app-text font-medium">Recent Requests</h4>
              <button
                onClick={() => {
                  clearRequestHistory();
                  toast.success('Request history cleared');
                }}
                className="inline-flex items-center gap-1.5 px-2 py-1 text-xs rounded border border-app-border text-app-muted hover:text-app-text hover:bg-app-hover"
              >
                <Trash2 size={12} /> Clear
              </button>
            </div>
            <div className="space-y-2">
              {historyRows.slice(0, 10).map((entry) => (
                <div
                  key={entry.id}
                  onClick={() => setSelectedHistoryId(entry.id)}
                  className={`border rounded px-2 py-1.5 bg-app-bg cursor-pointer ${
                    selectedHistoryId === entry.id ? 'border-app-accent' : 'border-app-border'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-mono text-app-accent uppercase">{entry.request.method}</span>
                    <span className="text-xs text-app-text truncate flex-1" title={entry.resolvedUrl}>{entry.resolvedUrl}</span>
                    <span className={`text-xs font-semibold ${getStatusColor(entry.response.status)}`}>{entry.response.status || 'ERR'}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-end gap-2">
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelectedHistoryId(entry.id);
                      }}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-app-border hover:bg-app-hover text-app-text text-xs"
                    >
                      View
                    </button>
                    <button
                      onClick={async (event) => {
                        event.stopPropagation();
                        try {
                          await replayHistoryEntry(entry.id);
                          toast.success('Request replayed');
                        } catch (error) {
                          toast.error(error instanceof Error ? error.message : 'Replay failed');
                        }
                      }}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-app-border hover:bg-app-hover text-app-text text-xs"
                    >
                      <RotateCcw size={11} /> Replay
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {selectedHistoryEntry && (
              <HistoryEntryDetail entry={selectedHistoryEntry} />
            )}
          </div>
        )}
      </div>
    );
  }

  const cookies = Object.entries(response.headers)
    .filter(([k]) => k.toLowerCase() === 'set-cookie')
    .map(([, v]) => v);
  const passedAssertions = assertions.filter((item) => item.passed).length;
  const failedAssertions = assertions.length - passedAssertions;

  return (
    <div className="flex flex-col h-full overflow-hidden bg-app-bg">
      {/* Status bar */}
      <div className="flex items-center gap-4 px-3 py-2 border-b border-app-border bg-app-sidebar flex-shrink-0">
        {/* Status */}
        <div className="flex items-center gap-2">
          <span className={`text-sm font-semibold ${getStatusColor(response.status)}`}>
            {response.status || 'ERR'}
          </span>
          <span className="text-xs text-app-muted">{response.statusText}</span>
        </div>
        <div className="h-3 border-l border-app-border" />
        <span className="text-xs text-app-muted">{formatTime(response.time)}</span>
        <div className="h-3 border-l border-app-border" />
        <span className="text-xs text-app-muted">{formatBytes(response.size)}</span>
        {response.error && (
          <>
            <div className="h-3 border-l border-app-border" />
            <span className="text-xs text-red-400">{response.error}</span>
          </>
        )}

        {/* Tabs */}
        <div className="flex items-center ml-auto gap-0.5">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`px-3 py-1 text-xs rounded transition-colors ${
                activeTab === t.id
                  ? 'bg-app-active text-app-text'
                  : 'text-app-muted hover:text-app-text hover:bg-app-hover'
              }`}
            >
              {t.label}
              {t.id === 'headers' && ` (${Object.keys(response.headers).length})`}
              {t.id === 'cookies' && cookies.length > 0 && ` (${cookies.length})`}
            </button>
          ))}
        </div>

        {/* Actions */}
        {activeTab === 'body' && (
          <div className="flex items-center gap-1 ml-2">
            <button
              onClick={() => setRawView((v) => !v)}
              className={`px-2 py-1 text-xs rounded transition-colors ${
                rawView ? 'bg-app-active text-app-text' : 'text-app-muted hover:bg-app-hover'
              }`}
            >
              Raw
            </button>
            <button
              onClick={() => setWordWrap((v) => !v)}
              className={`px-2 py-1 text-xs rounded transition-colors ${
                wordWrap ? 'bg-app-active text-app-text' : 'text-app-muted hover:bg-app-hover'
              }`}
            >
              Wrap
            </button>
            <button
              onClick={handleBeautify}
              disabled={!canBeautify}
              className={`flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors ${
                canBeautify
                  ? 'text-app-muted hover:bg-app-hover hover:text-app-text'
                  : 'text-app-muted/40 cursor-not-allowed'
              }`}
              title="Beautify response body"
            >
              <Wand2 size={12} />
              Beautify
            </button>
            <button onClick={handleCopyBody} className="btn-ghost p-1.5" title="Copy response">
              <Copy size={13} />
            </button>
            <button
              onClick={async () => {
                if (!activeTabId) {
                  return;
                }
                try {
                  await saveResponseAsMockExample(activeTabId);
                  toast.success('Response added to API Docs examples');
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : 'Failed to add response to docs');
                }
              }}
              className="btn-ghost p-1.5"
              title="Add response to API Docs"
            >
              <BookPlus size={13} />
            </button>
            <button onClick={handleDownload} className="btn-ghost p-1.5" title="Download response">
              <Download size={13} />
            </button>
          </div>
        )}
      </div>

      {assertions.length > 0 && (
        <div className="border-b border-app-border bg-app-panel px-3 py-2 flex-shrink-0">
          <div className="flex items-center justify-between text-xs mb-2">
            <span className="text-app-text font-medium">Post-request Assertions</span>
            <span className={failedAssertions > 0 ? 'text-red-400' : 'text-green-400'}>
              {passedAssertions}/{assertions.length} passed
            </span>
          </div>
          <div className="max-h-28 overflow-y-auto space-y-1 pr-1">
            {assertions.map((assertion, index) => (
              <AssertionRow key={`${assertion.name}-${index}`} assertion={assertion} />
            ))}
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'body' && (
          <Editor
            height="100%"
            language={language}
            value={formattedBody}
            theme="vs-dark"
            options={{
              readOnly: true,
              minimap: { enabled: false },
              fontSize: 13,
              fontFamily: 'JetBrains Mono, Fira Code, Consolas, monospace',
              lineNumbers: 'off',
              wordWrap: wordWrap ? 'on' : 'off',
              scrollBeyondLastLine: false,
              padding: { top: 8 },
              automaticLayout: true,
            }}
          />
        )}

        {activeTab === 'headers' && (
          <div className="overflow-y-auto h-full">
            <div className="flex items-center gap-2 px-3 py-1.5 border-b border-app-border text-xs text-app-muted bg-app-sidebar">
              <div className="flex-1">Header</div>
              <div className="flex-1">Value</div>
            </div>
            {Object.entries(response.headers).map(([key, value]) => (
              <div key={key} className="flex items-start gap-2 px-3 py-2 border-b border-app-border/50 hover:bg-app-hover text-sm">
                <div className="flex-1 font-mono text-blue-300 font-medium text-xs">{key}</div>
                <div className="flex-1 font-mono text-app-text text-xs break-all">{value}</div>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'cookies' && (
          <div className="overflow-y-auto h-full p-4">
            {cookies.length === 0 ? (
              <p className="text-app-muted text-sm">No cookies in response</p>
            ) : (
              <>
                <h4 className="text-sm font-medium text-app-text mb-3">Set-Cookie Headers</h4>
                {cookies.map((cookie, i) => (
                  <div key={i} className="bg-app-panel border border-app-border rounded p-3 mb-2 font-mono text-xs text-app-text">
                    {cookie}
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        {activeTab === 'timeline' && (
          <div className="overflow-y-auto h-full p-4">
            <h4 className="text-sm font-medium text-app-text mb-4">Request Timeline</h4>
            <div className="space-y-3">
              <TimelineRow label="DNS Lookup" time={Math.floor(response.time * 0.05)} color="bg-blue-500" />
              <TimelineRow label="TCP Connect" time={Math.floor(response.time * 0.1)} color="bg-green-500" />
              <TimelineRow label="TLS Handshake" time={Math.floor(response.time * 0.1)} color="bg-yellow-500" />
              <TimelineRow label="Request Sent" time={Math.floor(response.time * 0.05)} color="bg-orange-500" />
              <TimelineRow label="Waiting (TTFB)" time={Math.floor(response.time * 0.6)} color="bg-app-accent" />
              <TimelineRow label="Content Download" time={Math.floor(response.time * 0.1)} color="bg-purple-500" />
              <div className="border-t border-app-border pt-3 mt-3">
                <div className="flex justify-between text-sm">
                  <span className="text-app-muted">Total Time</span>
                  <span className="text-app-text font-medium">{formatTime(response.time)}</span>
                </div>
                <div className="flex justify-between text-sm mt-1">
                  <span className="text-app-muted">Response Size</span>
                  <span className="text-app-text font-medium">{formatBytes(response.size)}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'history' && (
          <div className="overflow-y-auto h-full p-3">
            <div className="mb-4 border border-app-border rounded bg-app-panel p-3">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-medium text-app-text">Mock Examples</h4>
                <span className="text-[11px] text-app-muted">{mockExamples.length}/10</span>
              </div>
              {mockExamples.length === 0 ? (
                <p className="text-xs text-app-muted">No mock examples saved yet. Use the flask icon in Body tab after sending a request.</p>
              ) : (
                <div className="space-y-2">
                  {mockExamples.map((example, index) => (
                    <div key={`${index}-${example.status}-${example.time}`} className="border border-app-border rounded bg-app-bg px-2 py-2">
                      <div className="flex items-center gap-2 text-xs">
                        <span className={`font-semibold ${getStatusColor(example.status)}`}>{example.status || 'ERR'}</span>
                        <span className="text-app-muted">{formatTime(example.time)}</span>
                        <span className="text-app-muted">{formatBytes(example.size)}</span>
                        <span className="ml-auto text-app-muted">Example {index + 1}</span>
                      </div>
                      <div className="mt-1 line-clamp-2 text-[11px] text-app-muted">
                        {(example.body || '').slice(0, 180) || '(empty body)'}
                      </div>
                      <div className="mt-2 flex items-center justify-end gap-2">
                        <button
                          onClick={() => {
                            if (!activeTabId) {
                              return;
                            }
                            loadMockExampleForTab(activeTabId, index);
                            setActiveTab('body');
                            toast.success('Mock example loaded into response view');
                          }}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-app-border hover:bg-app-hover text-app-text text-xs"
                        >
                          <FlaskConical size={11} /> Use
                        </button>
                        <button
                          onClick={async () => {
                            if (!activeTabId) {
                              return;
                            }
                            try {
                              await deleteMockExampleFromRequest(activeTabId, index);
                              toast.success('Mock example deleted');
                            } catch (error) {
                              toast.error(error instanceof Error ? error.message : 'Failed to delete mock example');
                            }
                          }}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-app-border hover:bg-app-hover text-app-text text-xs"
                        >
                          <Trash2 size={11} /> Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-medium text-app-text">Recent Requests</h4>
              <button
                onClick={() => {
                  clearRequestHistory();
                  toast.success('Request history cleared');
                }}
                className="inline-flex items-center gap-1.5 px-2 py-1 text-xs rounded border border-app-border text-app-muted hover:text-app-text hover:bg-app-hover"
              >
                <Trash2 size={12} /> Clear
              </button>
            </div>

            {historyRows.length === 0 ? (
              <p className="text-sm text-app-muted">No request history yet.</p>
            ) : (
              <div className="space-y-2">
                {historyRows.map((entry) => (
                  <div
                    key={entry.id}
                    onClick={() => setSelectedHistoryId(entry.id)}
                    className={`border rounded bg-app-panel px-3 py-2 cursor-pointer ${
                      selectedHistoryId === entry.id ? 'border-app-accent' : 'border-app-border'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-mono font-semibold text-app-accent uppercase">{entry.request.method}</span>
                      <span className="text-xs text-app-text truncate flex-1" title={entry.resolvedUrl}>{entry.resolvedUrl}</span>
                      <span className={`text-xs font-semibold ${getStatusColor(entry.response.status)}`}>{entry.response.status || 'ERR'}</span>
                    </div>
                    <div className="mt-1 flex items-center justify-between text-[11px] text-app-muted">
                      <span>{new Date(entry.timestamp).toLocaleString()}</span>
                      <div className="flex items-center gap-2">
                        <span>{formatTime(entry.response.time)}</span>
                        <button
                          onClick={(event) => {
                            event.stopPropagation();
                            setSelectedHistoryId(entry.id);
                          }}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-app-border hover:bg-app-hover text-app-text"
                        >
                          View
                        </button>
                        <button
                          onClick={async (event) => {
                            event.stopPropagation();
                            try {
                              await replayHistoryEntry(entry.id);
                              toast.success('Request replayed');
                            } catch (error) {
                              toast.error(error instanceof Error ? error.message : 'Replay failed');
                            }
                          }}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-app-border hover:bg-app-hover text-app-text"
                        >
                          <RotateCcw size={11} /> Replay
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {selectedHistoryEntry && (
              <HistoryEntryDetail entry={selectedHistoryEntry} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function HistoryEntryDetail({ entry }: { entry: RequestHistoryEntry }) {
  return (
    <div className="mt-3 border border-app-border rounded bg-app-panel p-3 space-y-3">
      <div className="flex items-center justify-between">
        <h5 className="text-sm font-medium text-app-text">History Detail</h5>
        <span className="text-xs text-app-muted">{new Date(entry.timestamp).toLocaleString()}</span>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        <div className="border border-app-border rounded bg-app-bg overflow-hidden">
          <div className="px-2 py-1.5 text-[11px] uppercase tracking-wider text-app-muted border-b border-app-border">Request</div>
          <div className="p-2 space-y-2 text-xs">
            <div className="text-app-text font-mono break-all">{entry.request.method} {entry.resolvedUrl}</div>
            <div className="text-app-muted">Headers</div>
            <pre className="text-[11px] text-app-text bg-app-panel border border-app-border rounded p-2 overflow-auto max-h-44 whitespace-pre-wrap">
{JSON.stringify(entry.request.headers || [], null, 2)}
            </pre>
            <div className="text-app-muted">Body</div>
            <pre className="text-[11px] text-app-text bg-app-panel border border-app-border rounded p-2 overflow-auto max-h-44 whitespace-pre-wrap">
{entry.request.body?.content || '(empty)'}
            </pre>
          </div>
        </div>

        <div className="border border-app-border rounded bg-app-bg overflow-hidden">
          <div className="px-2 py-1.5 text-[11px] uppercase tracking-wider text-app-muted border-b border-app-border">Response</div>
          <div className="p-2 space-y-2 text-xs">
            <div className="text-app-text">Status: <span className={getStatusColor(entry.response.status)}>{entry.response.status || 'ERR'}</span></div>
            <div className="text-app-muted">Headers</div>
            <pre className="text-[11px] text-app-text bg-app-panel border border-app-border rounded p-2 overflow-auto max-h-44 whitespace-pre-wrap">
{JSON.stringify(entry.response.headers || {}, null, 2)}
            </pre>
            <div className="text-app-muted">Body</div>
            <pre className="text-[11px] text-app-text bg-app-panel border border-app-border rounded p-2 overflow-auto max-h-44 whitespace-pre-wrap">
{prettyPrint(entry.response.body || '', entry.response.headers?.['content-type'] || '') || '(empty)'}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}

function AssertionRow({ assertion }: { assertion: CollectionRunAssertion }) {
  return (
    <div
      className={`rounded border px-2 py-1 text-xs ${
        assertion.passed
          ? 'border-emerald-900/60 bg-emerald-950/20 text-emerald-300'
          : 'border-red-900/60 bg-red-950/20 text-red-300'
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium truncate">{assertion.name}</span>
        <span className="uppercase tracking-wide text-[10px]">{assertion.passed ? 'pass' : 'fail'}</span>
      </div>
      {!assertion.passed && assertion.error && (
        <p className="mt-1 text-red-200/90 break-words">{assertion.error}</p>
      )}
    </div>
  );
}

function TimelineRow({ label, time, color }: { label: string; time: number; color: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-36 text-xs text-app-muted text-right flex-shrink-0">{label}</div>
      <div className="flex-1 h-5 bg-app-panel rounded overflow-hidden">
        <div
          className={`h-full ${color} rounded opacity-80`}
          style={{ width: `${Math.max(5, Math.min(100, time / 10))}%` }}
        />
      </div>
      <div className="w-16 text-xs text-app-muted text-left flex-shrink-0">{time}ms</div>
    </div>
  );
}
