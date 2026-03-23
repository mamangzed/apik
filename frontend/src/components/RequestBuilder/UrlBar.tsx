import { useMemo, useRef, useState } from 'react';
import { useAppStore } from '../../store';
import { HttpMethod } from '../../types';
import { Send, Save, ChevronDown, Loader2 } from 'lucide-react';
import { METHOD_BG_COLORS } from '../../utils/format';
import toast from 'react-hot-toast';

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

export default function UrlBar() {
  const {
    tabs,
    activeTabId,
    updateActiveRequest,
    sendRequest,
    loadingTabs,
    updateRequestInCollection,
    getActiveEnvironment,
  } = useAppStore();

  const [showMethodDropdown, setShowMethodDropdown] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  const activeTab = tabs.find((t) => t.id === activeTabId);
  if (!activeTab) return null;

  const req = activeTab.requestState.request;
  const isLoading = activeTabId ? loadingTabs.has(activeTabId) : false;
  const activeEnvironment = getActiveEnvironment();

  const activeEnvKeys = useMemo(() => {
    return new Set(
      (activeEnvironment?.variables || [])
        .filter((variable) => variable.enabled && variable.key.trim())
        .map((variable) => variable.key.trim()),
    );
  }, [activeEnvironment]);

  const highlightedUrl = useMemo(() => {
    const value = req.url || '';
    if (!value) {
      return [
        <span key="placeholder" className="text-app-muted">
          https://api.example.com/endpoint or http://localhost:3000/api
        </span>,
      ];
    }

    const tokenRegex = /\{\{([^}]+)\}\}/g;
    const nodes: React.ReactNode[] = [];
    let cursor = 0;
    let match: RegExpExecArray | null;

    while ((match = tokenRegex.exec(value)) !== null) {
      const tokenText = match[0];
      const tokenKey = (match[1] || '').trim();
      const start = match.index;

      if (start > cursor) {
        nodes.push(
          <span key={`plain-${cursor}`} className="text-app-text">
            {value.slice(cursor, start)}
          </span>,
        );
      }

      const existsInEnv = activeEnvKeys.has(tokenKey);
      nodes.push(
        <span key={`token-${start}`} className={existsInEnv ? 'text-emerald-300' : 'text-app-text'}>
          {tokenText}
        </span>,
      );
      cursor = start + tokenText.length;
    }

    if (cursor < value.length) {
      nodes.push(
        <span key={`plain-tail-${cursor}`} className="text-app-text">
          {value.slice(cursor)}
        </span>,
      );
    }

    return nodes.length > 0
      ? nodes
      : [
          <span key="url-plain" className="text-app-text">
            {value}
          </span>,
        ];
  }, [activeEnvKeys, req.url]);

  const handleSend = async () => {
    if (!activeTabId) return;
    if (!req.url.trim()) {
      toast.error('Please enter a URL');
      inputRef.current?.focus();
      return;
    }
    await sendRequest(activeTabId);
  };

  const handleSave = async () => {
    const { collectionId } = activeTab.requestState;
    if (!collectionId) {
      toast('Request is not in a collection. Open a collection request to save.', { icon: 'ℹ️' });
      return;
    }
    try {
      await updateRequestInCollection(collectionId, req);
      toast.success('Saved!');
    } catch {
      toast.error('Failed to save');
    }
  };

  return (
    <div className="flex flex-col gap-2 px-3 py-2.5 border-b border-app-border bg-app-bg flex-shrink-0">
      <div className="flex items-center gap-2 w-full min-w-0">
        {/* Method Selector */}
        <div className="relative flex-shrink-0">
          <button
            onClick={() => setShowMethodDropdown((v) => !v)}
            className={`flex items-center gap-1 px-3 py-1.5 rounded text-[11px] sm:text-xs font-bold font-mono w-[86px] justify-between ${
              METHOD_BG_COLORS[req.method] || 'bg-app-panel text-app-muted'
            }`}
          >
            {req.method}
            <ChevronDown size={11} />
          </button>
          {showMethodDropdown && (
            <div className="absolute left-0 mt-1 bg-app-panel border border-app-border rounded shadow-xl z-50 py-1">
              {METHODS.map((m) => (
                <button
                  key={m}
                  onClick={() => {
                    updateActiveRequest({ method: m });
                    setShowMethodDropdown(false);
                  }}
                  className={`w-full flex items-center px-4 py-1.5 text-xs font-mono font-bold hover:bg-app-hover transition-colors ${
                    METHOD_BG_COLORS[m]?.split(' ')[1] || 'text-app-muted'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* URL Input with env-variable highlighting */}
        <div className="relative flex-1 min-w-0">
          <div
            ref={overlayRef}
            className="pointer-events-none absolute inset-0 overflow-hidden bg-app-panel border border-app-border rounded px-3 py-1.5 text-[12px] sm:text-sm font-mono whitespace-pre"
            aria-hidden="true"
          >
            {highlightedUrl}
          </div>
          <input
            ref={inputRef}
            type="text"
            value={req.url}
            onChange={(e) => updateActiveRequest({ url: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            onScroll={(e) => {
              if (overlayRef.current) {
                overlayRef.current.scrollLeft = e.currentTarget.scrollLeft;
              }
            }}
            className="relative z-10 w-full bg-transparent border border-app-border rounded px-3 py-1.5 text-[12px] sm:text-sm font-mono text-transparent caret-app-text focus:outline-none focus:border-app-accent transition-colors"
            spellCheck={false}
          />
        </div>

        {/* Send */}
        <button
          onClick={handleSend}
          disabled={isLoading}
          className="flex items-center gap-1.5 bg-app-accent hover:bg-app-accent-hover disabled:opacity-60 text-[12px] sm:text-sm font-medium px-3 sm:px-4 py-1.5 rounded transition-colors min-w-[72px] sm:min-w-20 justify-center flex-shrink-0"
          title="Send request (Ctrl+Enter)"
        >
          {isLoading ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Send size={14} />
          )}
          <span className="hidden sm:inline">{isLoading ? 'Sending' : 'Send'}</span>
        </button>
      </div>

      <div className="flex items-center gap-2 w-full">
        {/* Name input */}
        <input
          type="text"
          value={req.name}
          onChange={(e) => updateActiveRequest({ name: e.target.value })}
          placeholder="Request name"
          className="flex-1 sm:flex-none sm:w-44 bg-transparent border border-app-border rounded px-2 py-1.5 text-[12px] sm:text-sm text-app-muted focus:outline-none focus:border-app-accent transition-colors min-w-0"
        />

        {/* Save */}
        <button
          onClick={handleSave}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] sm:text-sm text-app-muted hover:text-app-text hover:bg-app-hover border border-app-border rounded transition-colors flex-shrink-0"
          title="Save request (Ctrl+S)"
        >
          <Save size={14} />
          <span className="hidden sm:inline">Save</span>
        </button>
      </div>
    </div>
  );
}
