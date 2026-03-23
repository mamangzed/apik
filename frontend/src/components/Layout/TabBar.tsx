import { useState } from 'react';
import { useAppStore } from '../../store';
import { X, Plus } from 'lucide-react';
import { METHOD_COLORS } from '../../utils/format';

export default function TabBar() {
  const {
    tabs,
    activeTabId,
    closeTab,
    setActiveTab,
    reorderTabs,
    openNewTab,
    updateActiveRequest,
    interceptedRequests,
    interceptTabOpen,
    showInterceptPanel,
    setShowInterceptPanel,
    closeInterceptTab,
    pendingCloseTabId,
    confirmCloseTab,
    cancelCloseTab,
  } = useAppStore();
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [draggingTabId, setDraggingTabId] = useState<string | null>(null);
  const pendingCloseTab = pendingCloseTabId ? tabs.find((tab) => tab.id === pendingCloseTabId) : null;
  const pendingInterceptCount = interceptedRequests.filter((request) => request.status === 'pending').length;

  if (tabs.length === 0 && !interceptTabOpen) return null;

  return (
    <>
      <div className="flex items-center bg-app-sidebar border-b border-app-border overflow-x-auto flex-shrink-0 min-h-[36px]">
        <div className="flex items-center flex-1 overflow-x-auto">
        {interceptTabOpen && (
          <div
            onClick={() => setShowInterceptPanel(true)}
            className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-2 cursor-pointer border-r border-app-border flex-shrink-0 max-w-40 sm:max-w-44 group transition-colors ${
              showInterceptPanel
                ? 'bg-app-bg border-b-2 border-b-app-accent -mb-px'
                : 'hover:bg-app-hover text-app-muted'
            }`}
          >
            <span className="text-xs font-mono font-bold flex-shrink-0 text-orange-300">TRF</span>
            <span className="text-sm truncate text-app-text">Traffic</span>
            <span className="text-[10px] rounded-full px-1.5 py-0.5 bg-orange-500 text-white">
              {pendingInterceptCount}
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); closeInterceptTab(); }}
                className="p-0.5 hover:bg-app-active rounded transition-opacity flex-shrink-0 ml-auto"
            >
              <X size={12} />
            </button>
          </div>
        )}
        {tabs.map((tab) => {
          const req = tab.requestState.request;
          const isActive = !showInterceptPanel && tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              draggable
              onClick={() => {
                if (showInterceptPanel) setShowInterceptPanel(false);
                setActiveTab(tab.id);
              }}
              onDragStart={() => setDraggingTabId(tab.id)}
              onDragOver={(event) => {
                if (!draggingTabId || draggingTabId === tab.id) {
                  return;
                }
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (!draggingTabId || draggingTabId === tab.id) {
                  return;
                }
                reorderTabs(draggingTabId, tab.id);
                setDraggingTabId(null);
              }}
              onDragEnd={() => setDraggingTabId(null)}
              className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-2 cursor-pointer border-r border-app-border flex-shrink-0 max-w-40 sm:max-w-44 group transition-colors ${
                isActive
                  ? 'bg-app-bg border-b-2 border-b-app-accent -mb-px'
                  : 'hover:bg-app-hover text-app-muted'
              }`}
            >
              <span className={`text-xs font-mono font-bold flex-shrink-0 ${METHOD_COLORS[req.method] || ''}`}>
                {req.method.substring(0, 3)}
              </span>
              {editingTabId === tab.id ? (
                <input
                  autoFocus
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  onBlur={() => {
                    setActiveTab(tab.id);
                    updateActiveRequest({ name: editingName.trim() || 'New Request' });
                    setEditingTabId(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      setActiveTab(tab.id);
                      updateActiveRequest({ name: editingName.trim() || 'New Request' });
                      setEditingTabId(null);
                    } else if (e.key === 'Escape') {
                      setEditingTabId(null);
                    }
                  }}
                  className="text-sm bg-app-panel border border-app-border rounded px-1.5 py-0.5 text-app-text w-32"
                />
              ) : (
                <span
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    setEditingTabId(tab.id);
                    setEditingName(req.name || '');
                  }}
                  className={`text-sm truncate ${isActive ? 'text-app-text' : ''}`}
                  title="Double click to rename"
                >
                  {req.name || 'New Request'}
                </span>
              )}
              {tab.requestState.isDirty && (
                <span className="w-1.5 h-1.5 rounded-full bg-app-accent flex-shrink-0" />
              )}
              <button
                onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
                className="p-0.5 hover:bg-app-active rounded opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity flex-shrink-0 ml-auto"
              >
                <X size={12} />
              </button>
            </div>
          );
        })}
        </div>
        <button
          onClick={openNewTab}
          className="flex-shrink-0 p-2 hover:bg-app-hover text-app-muted hover:text-app-text transition-colors border-l border-app-border"
          title="New tab"
        >
          <Plus size={14} />
        </button>
      </div>

      {pendingCloseTab && (
        <div className="fixed inset-0 z-[70] bg-black/50 flex items-center justify-center p-4">
          <div className="w-full max-w-sm rounded-lg border border-app-border bg-app-panel shadow-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-app-border bg-app-sidebar">
              <h3 className="text-sm font-semibold text-app-text">Unsaved Changes</h3>
            </div>
            <div className="px-4 py-4">
              <p className="text-sm text-app-text">
                <span className="font-medium">{pendingCloseTab.requestState.request.name || 'This request'}</span> has unsaved changes. Close this tab anyway?
              </p>
            </div>
            <div className="px-4 py-3 border-t border-app-border bg-app-sidebar flex items-center justify-end gap-2">
              <button
                onClick={cancelCloseTab}
                className="px-3 py-1.5 text-sm rounded border border-app-border text-app-muted hover:text-app-text hover:bg-app-hover"
              >
                Cancel
              </button>
              <button
                onClick={confirmCloseTab}
                className="px-3 py-1.5 text-sm rounded bg-red-700 hover:bg-red-600 text-white"
              >
                Close Tab
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
