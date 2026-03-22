import { useMemo, useState } from 'react';
import { Copy, Download, Wand2 } from 'lucide-react';
import Editor from '@monaco-editor/react';
import toast from 'react-hot-toast';
import { ProxyResponse, ResponseTab } from '../../types';
import { canBeautifyContent, detectLanguage, formatBytes, formatTime, getStatusColor, prettyPrint } from '../../utils/format';

const TABS: { id: ResponseTab; label: string }[] = [
  { id: 'body', label: 'Body' },
  { id: 'headers', label: 'Headers' },
  { id: 'cookies', label: 'Cookies' },
  { id: 'timeline', label: 'Timeline' },
];

type Props = {
  response: ProxyResponse;
};

export default function PublicResponseViewer({ response }: Props) {
  const [activeTab, setActiveTab] = useState<ResponseTab>('body');
  const [wordWrap, setWordWrap] = useState(true);
  const [rawView, setRawView] = useState(false);

  const contentType = response.headers?.['content-type'] || '';
  const language = detectLanguage(contentType, response.body || '');
  const canBeautify = canBeautifyContent(response.body || '', language, contentType);

  const formattedBody = useMemo(() => {
    if (rawView) {
      return response.body;
    }
    return prettyPrint(response.body || '', contentType);
  }, [contentType, rawView, response.body]);

  const cookies = Object.entries(response.headers || {})
    .filter(([key]) => key.toLowerCase() === 'set-cookie')
    .map(([, value]) => value);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(formattedBody);
    toast.success('Response copied');
  };

  const handleDownload = () => {
    const ext = language === 'json' ? 'json' : language === 'xml' ? 'xml' : 'txt';
    const blob = new Blob([formattedBody], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `response.${ext}`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const handleBeautify = () => {
    if (!canBeautify) {
      toast('This response cannot be beautified');
      return;
    }

    setRawView(false);
    toast.success('Beautified response view');
  };

  return (
    <div className="flex flex-col h-[420px] overflow-hidden bg-app-bg border border-app-border rounded-lg">
      <div className="flex items-center gap-4 px-3 py-2 border-b border-app-border bg-app-sidebar flex-shrink-0">
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

        <div className="flex items-center ml-auto gap-0.5">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-1 text-xs rounded transition-colors ${
                activeTab === tab.id
                  ? 'bg-app-active text-app-text'
                  : 'text-app-muted hover:text-app-text hover:bg-app-hover'
              }`}
            >
              {tab.label}
              {tab.id === 'headers' && ` (${Object.keys(response.headers || {}).length})`}
              {tab.id === 'cookies' && cookies.length > 0 && ` (${cookies.length})`}
            </button>
          ))}
        </div>

        {activeTab === 'body' && (
          <div className="flex items-center gap-1 ml-2">
            <button
              onClick={() => setRawView((value) => !value)}
              className={`px-2 py-1 text-xs rounded transition-colors ${
                rawView ? 'bg-app-active text-app-text' : 'text-app-muted hover:bg-app-hover'
              }`}
            >
              Raw
            </button>
            <button
              onClick={() => setWordWrap((value) => !value)}
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
            >
              <Wand2 size={12} />
              Beautify
            </button>
            <button onClick={handleCopy} className="btn-ghost p-1.5" title="Copy response">
              <Copy size={13} />
            </button>
            <button onClick={handleDownload} className="btn-ghost p-1.5" title="Download response">
              <Download size={13} />
            </button>
          </div>
        )}
      </div>

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
            {Object.entries(response.headers || {}).map(([key, value]) => (
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
                {cookies.map((cookie, idx) => (
                  <div key={idx} className="bg-app-panel border border-app-border rounded p-3 mb-2 font-mono text-xs text-app-text">
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
      </div>
    </div>
  );
}

function TimelineRow({ label, time, color }: { label: string; time: number; color: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-36 text-xs text-app-muted text-right flex-shrink-0">{label}</div>
      <div className="flex-1 h-5 bg-app-panel rounded overflow-hidden">
        <div className={`h-full ${color} rounded opacity-80`} style={{ width: `${Math.max(5, Math.min(100, time / 10))}%` }} />
      </div>
      <div className="w-16 text-xs text-app-muted text-left flex-shrink-0">{time}ms</div>
    </div>
  );
}