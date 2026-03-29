import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../store';
import { RequestTab } from '../../types';
import ParamsTab from './ParamsTab';
import HeadersTab from './HeadersTab';
import BodyTab from './BodyTab';
import AuthTab from './AuthTab';
import ScriptTab from './ScriptTab';
import DocsTab from './DocsTab';
import { Search, X } from 'lucide-react';

const TABS: { id: RequestTab; label: string }[] = [
  { id: 'params', label: 'Params' },
  { id: 'headers', label: 'Headers' },
  { id: 'body', label: 'Body' },
  { id: 'auth', label: 'Auth' },
  { id: 'pre-script', label: 'Pre-Request' },
  { id: 'test-script', label: 'Post-Request' },
  { id: 'docs', label: 'Docs' },
];

const SEARCHABLE_TABS: RequestTab[] = ['params', 'headers'];

export default function RequestTabs() {
  const [activeTab, setActiveTab] = useState<RequestTab>('params');
  const [searchFilter, setSearchFilter] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const { tabs, activeTabId } = useAppStore();

  const tab = tabs.find((t) => t.id === activeTabId);

  useEffect(() => {
    const handleFind = () => {
      if (SEARCHABLE_TABS.includes(activeTab)) {
        setShowSearch(true);
        // Defer to next tick so the input is rendered
        setTimeout(() => { searchInputRef.current?.focus(); searchInputRef.current?.select(); }, 0);
      }
    };
    window.addEventListener('__apix_find__', handleFind as EventListener);
    return () => window.removeEventListener('__apix_find__', handleFind as EventListener);
  }, [activeTab]);

  const closeSearch = () => {
    setShowSearch(false);
    setSearchFilter('');
  };

  if (!tab) return null;

  const req = tab.requestState.request;

  const getTabBadge = (tabId: RequestTab): number => {
    if (tabId === 'params') return req.params.filter((p) => p.enabled && p.key).length;
    if (tabId === 'headers') return req.headers.filter((h) => h.enabled && h.key).length;
    if (tabId === 'body') return req.body.type !== 'none' ? 1 : 0;
    if (tabId === 'auth') return req.auth.type !== 'none' ? 1 : 0;
    return 0;
  };

  const isSearchApplicable = SEARCHABLE_TABS.includes(activeTab);
  const activeFilter = isSearchApplicable ? searchFilter : '';

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Tab headers */}
      <div className="flex items-center border-b border-app-border bg-app-sidebar flex-shrink-0 overflow-x-auto">
        {TABS.map((t) => {
          const badge = getTabBadge(t.id);
          return (
            <button
              key={t.id}
              onClick={() => {
                setActiveTab(t.id);
                if (!SEARCHABLE_TABS.includes(t.id)) closeSearch();
              }}
              className={`tab-btn !text-[11px] sm:!text-sm flex items-center gap-1.5 flex-shrink-0 ${activeTab === t.id ? 'active' : ''}`}
            >
              {t.label}
              {badge > 0 && (
                <span className="bg-app-accent text-white text-xs rounded-full w-4 h-4 flex items-center justify-center leading-none">
                  {badge}
                </span>
              )}
            </button>
          );
        })}
        {isSearchApplicable && (
          <button
            onClick={() => {
              setShowSearch(true);
              setTimeout(() => { searchInputRef.current?.focus(); }, 0);
            }}
            className="ml-auto mr-1 p-1.5 text-app-muted hover:text-app-text hover:bg-app-hover rounded transition-colors flex-shrink-0"
            title="Search (Ctrl+F)"
          >
            <Search size={13} />
          </button>
        )}
      </div>

      {/* Search bar */}
      {showSearch && isSearchApplicable && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-app-border bg-app-panel flex-shrink-0">
          <Search size={12} className="text-app-muted flex-shrink-0" />
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Filter by key or value…"
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') closeSearch(); }}
            className="flex-1 bg-transparent text-[12px] sm:text-sm focus:outline-none text-app-text placeholder-app-muted"
          />
          {searchFilter && (
            <span className="text-[11px] sm:text-xs text-app-muted flex-shrink-0">
              {activeTab === 'params'
                ? req.params.filter(p => p.key.toLowerCase().includes(searchFilter.toLowerCase()) || p.value.toLowerCase().includes(searchFilter.toLowerCase())).length
                : req.headers.filter(h => h.key.toLowerCase().includes(searchFilter.toLowerCase()) || h.value.toLowerCase().includes(searchFilter.toLowerCase())).length
              } result(s)
            </span>
          )}
          <button onClick={closeSearch} className="text-app-muted hover:text-app-text flex-shrink-0">
            <X size={13} />
          </button>
        </div>
      )}

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'params' && <ParamsTab filter={activeFilter} />}
        {activeTab === 'headers' && <HeadersTab filter={activeFilter} />}
        {activeTab === 'body' && <BodyTab />}
        {activeTab === 'auth' && <AuthTab />}
        {activeTab === 'pre-script' && <ScriptTab type="pre" />}
        {activeTab === 'test-script' && <ScriptTab type="test" />}
        {activeTab === 'docs' && <DocsTab />}
      </div>
    </div>
  );
}
