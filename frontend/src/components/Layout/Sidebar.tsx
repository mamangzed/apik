import { useState } from 'react';
import { useAppStore } from '../../store';
import {
  Plus,
  Search,
  FolderOpen,
  FileText,
  ChevronRight,
  ChevronDown,
  Trash2,
  Edit3,
  Book,
  Upload,
  MoreHorizontal,
  X,
  AlertTriangle,
  Share2,
  Play,
  Activity,
  Globe2,
  Lock,
  RefreshCw,
  Download,
} from 'lucide-react';
import { Collection, ApiRequest } from '../../types';
import { METHOD_COLORS } from '../../utils/format';
import toast from 'react-hot-toast';
import { ExportTargetFormat, serializeCollectionExport } from '../../lib/collectionTransfer';

export default function Sidebar() {
  const {
    collections,
    searchQuery,
    setSearchQuery,
    createCollection,
    deleteCollection,
    renameCollection,
    addRequestToCollection,
    reorderRequestInCollection,
    updateRequestInCollection,
    deleteRequestFromCollection,
    openTab,
    setShowInterceptPanel,
    setShowDocViewer,
    setShowImportModal,
    openShareModal,
    runCollection,
    storageMode,
    loadCollections,
  } = useAppStore();

  const [expandedCollections, setExpandedCollections] = useState<Set<string>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [modal, setModal] = useState<
    | { type: 'create-collection'; value: string }
    | { type: 'rename-collection'; collectionId: string; value: string }
    | { type: 'rename-request'; collectionId: string; requestId: string; value: string }
    | { type: 'delete-collection'; collectionId: string }
    | { type: 'delete-request'; collectionId: string; requestId: string }
    | null
  >(null);
  const [contextMenu, setContextMenu] = useState<{
    type: 'collection' | 'request';
    id: string;
    collectionId?: string;
    x: number;
    y: number;
  } | null>(null);
  const [reportViewerCollectionId, setReportViewerCollectionId] = useState<string | null>(null);
  const [draggingRequest, setDraggingRequest] = useState<{ collectionId: string; requestId: string } | null>(null);
  const [requestDropTarget, setRequestDropTarget] = useState<{ collectionId: string; requestId: string } | null>(null);

  const toggleCollection = (id: string) => {
    setExpandedCollections((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleAddRequest = async (collectionId: string) => {
    await addRequestToCollection(collectionId, { name: 'New Request', method: 'GET', url: '' });
    setExpandedCollections((previous) => new Set(previous).add(collectionId));
    toast.success('Request added');
  };

  const openContextMenu = (
    event: React.MouseEvent,
    type: 'collection' | 'request',
    id: string,
    collectionId?: string,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({ type, id, collectionId, x: event.clientX, y: event.clientY });
  };

  const closeContextMenu = () => setContextMenu(null);

  const handleRequestDragStart = (collectionId: string, requestId: string, event: React.DragEvent) => {
    event.stopPropagation();
    setDraggingRequest({ collectionId, requestId });
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', `${collectionId}:${requestId}`);
  };

  const handleRequestDragOver = (collectionId: string, requestId: string, event: React.DragEvent) => {
    if (!draggingRequest || draggingRequest.collectionId !== collectionId || draggingRequest.requestId === requestId) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';

    if (!requestDropTarget || requestDropTarget.collectionId !== collectionId || requestDropTarget.requestId !== requestId) {
      setRequestDropTarget({ collectionId, requestId });
    }
  };

  const handleRequestDrop = async (collectionId: string, requestId: string, event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();

    if (!draggingRequest || draggingRequest.collectionId !== collectionId || draggingRequest.requestId === requestId) {
      setRequestDropTarget(null);
      return;
    }

    try {
      await reorderRequestInCollection(collectionId, draggingRequest.requestId, requestId);
      toast.success('Request order updated');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to reorder request');
    } finally {
      setDraggingRequest(null);
      setRequestDropTarget(null);
    }
  };

  const handleRequestDragEnd = () => {
    setDraggingRequest(null);
    setRequestDropTarget(null);
  };

  const handleExportCollection = (collectionId: string, format: ExportTargetFormat) => {
    const collection = collections.find((entry) => entry.id === collectionId);
    if (!collection) {
      toast.error('Collection not found');
      return;
    }

    try {
      const exported = serializeCollectionExport(collection, format);
      const blob = new Blob([exported.content], { type: exported.mimeType });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = exported.filename;
      anchor.click();
      URL.revokeObjectURL(url);
      toast.success(`Collection exported as ${format.toUpperCase()}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to export collection');
    }
  };

  const closeModal = () => {
    if (!isSubmitting) {
      setModal(null);
    }
  };

  const submitModal = async () => {
    if (!modal) return;
    setIsSubmitting(true);

    try {
      if (modal.type === 'create-collection') {
        const name = modal.value.trim();
        if (!name) {
          toast.error('Collection name is required');
          return;
        }
        await createCollection(name);
        toast.success('Collection created');
      }

      if (modal.type === 'rename-collection') {
        const name = modal.value.trim();
        if (!name) {
          toast.error('Collection name is required');
          return;
        }
        await renameCollection(modal.collectionId, name);
        toast.success('Collection renamed');
      }

      if (modal.type === 'rename-request') {
        const name = modal.value.trim();
        if (!name) {
          toast.error('Request name is required');
          return;
        }
        const collection = collections.find((entry) => entry.id === modal.collectionId);
        const request = collection?.requests.find((entry) => entry.id === modal.requestId);
        if (!collection || !request) {
          toast.error('Request not found');
          return;
        }
        await updateRequestInCollection(modal.collectionId, {
          ...request,
          name,
        });
        toast.success('Request renamed');
      }

      if (modal.type === 'delete-collection') {
        await deleteCollection(modal.collectionId);
        toast.success('Collection deleted');
      }

      if (modal.type === 'delete-request') {
        await deleteRequestFromCollection(modal.collectionId, modal.requestId);
        toast.success('Request deleted');
      }

      setModal(null);
    } catch (error) {
      toast.error(`Action failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredCollections = searchQuery
    ? collections
        .map((collection) => ({
          ...collection,
          requests: collection.requests.filter(
            (request) =>
              request.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
              request.url.toLowerCase().includes(searchQuery.toLowerCase()),
          ),
        }))
        .filter(
          (collection) =>
            collection.requests.length > 0 || collection.name.toLowerCase().includes(searchQuery.toLowerCase()),
        )
    : collections;

  return (
    <div className="flex flex-col h-full bg-app-sidebar border-r border-app-border" onClick={closeContextMenu}>
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-app-border">
        <div>
          <span className="text-xs font-semibold text-app-muted uppercase tracking-wider">Collections</span>
          <div className="text-[11px] text-app-muted mt-0.5">
            {storageMode === 'remote' ? 'Synced across devices' : 'Stored on this device only'}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={async () => {
              try {
                await loadCollections();
                toast.success('Collections refreshed');
              } catch (error) {
                toast.error(error instanceof Error ? error.message : 'Failed to refresh collections');
              }
            }}
            className="p-1 hover:bg-app-hover rounded text-app-muted hover:text-app-text transition-colors"
            title="Refresh collections"
          >
            <RefreshCw size={13} />
          </button>
          <button
            onClick={() => setShowImportModal(true)}
            className="p-1 hover:bg-app-hover rounded text-app-muted hover:text-app-text transition-colors"
            title="Import collection"
          >
            <Upload size={13} />
          </button>
          <button
            onClick={() => setModal({ type: 'create-collection', value: '' })}
            className="p-1 hover:bg-app-hover rounded text-app-muted hover:text-app-text transition-colors"
            title="New collection"
          >
            <Plus size={14} />
          </button>
        </div>
      </div>

      <div className="px-2 py-2 border-b border-app-border">
        <div className="flex items-center gap-2 bg-app-panel border border-app-border rounded px-2 py-1.5">
          <Search size={12} className="text-app-muted flex-shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search requests..."
            className="bg-transparent text-sm text-app-text placeholder-app-muted outline-none flex-1 w-0"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {filteredCollections.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 gap-3 text-app-muted">
            <FolderOpen size={32} className="opacity-30" />
            <p className="text-xs text-center">
              No collections yet.
              <br />
              <button onClick={() => setModal({ type: 'create-collection', value: '' })} className="text-app-accent hover:underline mt-1 block">
                Create one
              </button>
            </p>
          </div>
        ) : (
          filteredCollections.map((collection) => (
            <CollectionItem
              key={collection.id}
              collection={collection}
              isExpanded={expandedCollections.has(collection.id)}
              onToggle={() => toggleCollection(collection.id)}
              onOpenRequest={(request) => {
                setShowInterceptPanel(false);
                openTab(request, collection.id);
              }}
              onAddRequest={() => handleAddRequest(collection.id)}
              onContextMenu={(event, type, id, collectionId) => openContextMenu(event, type, id, collectionId)}
              onViewDocs={() => setShowDocViewer(true, collection.id)}
              onShareCollection={() => openShareModal(collection.id, 'collection')}
              draggingRequest={draggingRequest}
              requestDropTarget={requestDropTarget}
              onRequestDragStart={handleRequestDragStart}
              onRequestDragOver={handleRequestDragOver}
              onRequestDrop={handleRequestDrop}
              onRequestDragEnd={handleRequestDragEnd}
              storageMode={storageMode}
            />
          ))
        )}
      </div>

      {contextMenu && (
        <div
          style={{ top: contextMenu.y, left: contextMenu.x }}
          className="fixed z-50 bg-app-panel border border-app-border rounded shadow-xl py-1 min-w-44"
          onClick={(event) => event.stopPropagation()}
        >
          {contextMenu.type === 'collection' ? (
            <>
              <button
                className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-app-hover text-app-text transition-colors"
                onClick={() => {
                  const existing = collections.find((collection) => collection.id === contextMenu.id);
                  setModal({ type: 'rename-collection', collectionId: contextMenu.id, value: existing?.name || '' });
                  closeContextMenu();
                }}
              >
                <Edit3 size={13} /> Rename
              </button>
              <button
                className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-app-hover text-app-text transition-colors"
                onClick={() => {
                  handleAddRequest(contextMenu.id);
                  closeContextMenu();
                }}
              >
                <Plus size={13} /> Add Request
              </button>
              <button
                className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-app-hover text-app-text transition-colors"
                onClick={async () => {
                  try {
                    const report = await runCollection(contextMenu.id);
                    toast.success(`Run finished: ${report.passed}/${report.total} passed`);
                  } catch (error) {
                    toast.error(error instanceof Error ? error.message : 'Failed to run collection');
                  } finally {
                    closeContextMenu();
                  }
                }}
              >
                <Play size={13} /> Run Collection
              </button>
              <button
                className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-app-hover text-app-text transition-colors"
                onClick={() => {
                  setReportViewerCollectionId(contextMenu.id);
                  closeContextMenu();
                }}
              >
                <Activity size={13} /> View Runs & Activity
              </button>
              {storageMode === 'remote' && (
                <>
                  <button
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-app-hover text-app-text transition-colors"
                    onClick={() => {
                      openShareModal(contextMenu.id, 'collection');
                      closeContextMenu();
                    }}
                  >
                    <Share2 size={13} /> Share Collection
                  </button>
                  <button
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-app-hover text-app-text transition-colors"
                    onClick={() => {
                      openShareModal(contextMenu.id, 'form');
                      closeContextMenu();
                    }}
                  >
                    <Share2 size={13} /> Share Form
                  </button>
                </>
              )}
              <button
                className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-app-hover text-app-text transition-colors"
                onClick={() => {
                  handleExportCollection(contextMenu.id, 'apik');
                  closeContextMenu();
                }}
              >
                <Download size={13} /> Export APIK
              </button>
              <button
                className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-app-hover text-app-text transition-colors"
                onClick={() => {
                  handleExportCollection(contextMenu.id, 'postman');
                  closeContextMenu();
                }}
              >
                <Download size={13} /> Export Postman
              </button>
              <button
                className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-app-hover text-app-text transition-colors"
                onClick={() => {
                  handleExportCollection(contextMenu.id, 'openapi');
                  closeContextMenu();
                }}
              >
                <Download size={13} /> Export OpenAPI
              </button>
              <div className="border-t border-app-border my-1" />
              <button
                className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-red-900/30 text-red-400 transition-colors"
                onClick={() => {
                  setModal({ type: 'delete-collection', collectionId: contextMenu.id });
                  closeContextMenu();
                }}
              >
                <Trash2 size={13} /> Delete
              </button>
            </>
          ) : (
            <>
              <button
                className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-app-hover text-app-text transition-colors"
                onClick={() => {
                  if (!contextMenu.collectionId) {
                    closeContextMenu();
                    return;
                  }
                  const collection = collections.find((entry) => entry.id === contextMenu.collectionId);
                  const request = collection?.requests.find((entry) => entry.id === contextMenu.id);
                  setModal({
                    type: 'rename-request',
                    collectionId: contextMenu.collectionId,
                    requestId: contextMenu.id,
                    value: request?.name || '',
                  });
                  closeContextMenu();
                }}
              >
                <Edit3 size={13} /> Rename Request
              </button>
              <div className="border-t border-app-border my-1" />
              <button
                className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-red-900/30 text-red-400 transition-colors"
                onClick={() => {
                  if (contextMenu.collectionId) {
                    setModal({
                      type: 'delete-request',
                      collectionId: contextMenu.collectionId,
                      requestId: contextMenu.id,
                    });
                  }
                  closeContextMenu();
                }}
              >
                <Trash2 size={13} /> Delete Request
              </button>
            </>
          )}
        </div>
      )}

      {reportViewerCollectionId && (
        <div className="fixed inset-0 z-[65] bg-black/50 flex items-center justify-center p-4" onClick={() => setReportViewerCollectionId(null)}>
          <div className="w-full max-w-3xl max-h-[82vh] overflow-hidden rounded-lg border border-app-border bg-app-panel shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="px-4 py-3 border-b border-app-border bg-app-sidebar flex items-center justify-between">
              <h3 className="text-sm font-semibold text-app-text">Collection Runs & Activity</h3>
              <button className="p-1 rounded hover:bg-app-hover text-app-muted hover:text-app-text" onClick={() => setReportViewerCollectionId(null)}>
                <X size={14} />
              </button>
            </div>
            <div className="grid md:grid-cols-2 gap-4 p-4 overflow-y-auto max-h-[72vh]">
              <div>
                <h4 className="text-xs uppercase tracking-wider text-app-muted mb-2">Run Reports</h4>
                {(() => {
                  const collection = collections.find((entry) => entry.id === reportViewerCollectionId);
                  const reports = collection?.runReports || [];
                  if (reports.length === 0) {
                    return <p className="text-sm text-app-muted">No runs yet.</p>;
                  }

                  return (
                    <div className="space-y-2">
                      {reports.slice(0, 20).map((report) => (
                        <div key={report.id} className="border border-app-border rounded bg-app-bg px-3 py-2">
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-app-text">{new Date(report.startedAt).toLocaleString()}</span>
                            <span className={`text-sm font-semibold ${report.failed > 0 ? 'text-red-400' : 'text-green-400'}`}>
                              {report.passed}/{report.total}
                            </span>
                          </div>
                          <p className="text-xs text-app-muted mt-1">Failed: {report.failed}</p>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
              <div>
                <h4 className="text-xs uppercase tracking-wider text-app-muted mb-2">Activity Log</h4>
                {(() => {
                  const collection = collections.find((entry) => entry.id === reportViewerCollectionId);
                  const audit = collection?.auditLog || [];
                  if (audit.length === 0) {
                    return <p className="text-sm text-app-muted">No activity yet.</p>;
                  }

                  return (
                    <div className="space-y-2">
                      {audit.slice(0, 30).map((entry) => (
                        <div key={entry.id} className="border border-app-border rounded bg-app-bg px-3 py-2">
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-app-text">{entry.action}</span>
                            <span className="text-xs text-app-muted">{new Date(entry.createdAt).toLocaleString()}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-app-panel border border-app-border rounded-lg shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-app-border bg-app-sidebar">
              <h3 className="text-sm font-semibold text-app-text">
                {modal.type === 'create-collection' && 'Create Collection'}
                {modal.type === 'rename-collection' && 'Rename Collection'}
                {modal.type === 'rename-request' && 'Rename Request'}
                {modal.type === 'delete-collection' && 'Delete Collection'}
                {modal.type === 'delete-request' && 'Delete Request'}
              </h3>
              <button onClick={closeModal} className="p-1 hover:bg-app-hover rounded text-app-muted hover:text-app-text" disabled={isSubmitting}>
                <X size={14} />
              </button>
            </div>

            <div className="p-4 space-y-3">
              {(modal.type === 'create-collection' || modal.type === 'rename-collection' || modal.type === 'rename-request') && (
                <>
                  <label className="text-xs text-app-muted uppercase tracking-wider">
                    {modal.type === 'rename-request' ? 'Request Name' : 'Collection Name'}
                  </label>
                  <input
                    autoFocus
                    value={modal.value}
                    onChange={(event) => setModal({ ...modal, value: event.target.value })}
                    onKeyDown={(event) => event.key === 'Enter' && submitModal()}
                    placeholder="e.g. User Service"
                    className="input-field"
                    disabled={isSubmitting}
                  />
                </>
              )}

              {(modal.type === 'delete-collection' || modal.type === 'delete-request') && (
                <div className="flex gap-3 p-3 rounded bg-red-900/20 border border-red-800/50">
                  <AlertTriangle size={16} className="text-red-400 mt-0.5 flex-shrink-0" />
                  <p className="text-sm text-red-200">
                    {modal.type === 'delete-collection'
                      ? 'Delete this collection and all requests inside it?'
                      : 'Delete this request from the collection?'}
                  </p>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-app-border bg-app-sidebar">
              <button onClick={closeModal} className="px-3 py-1.5 text-sm rounded border border-app-border text-app-muted hover:text-app-text hover:bg-app-hover" disabled={isSubmitting}>
                Cancel
              </button>
              <button
                onClick={submitModal}
                className={`px-3 py-1.5 text-sm rounded text-white ${
                  modal.type === 'delete-collection' || modal.type === 'delete-request'
                    ? 'bg-red-700 hover:bg-red-600'
                    : 'bg-app-accent hover:bg-app-accent-hover'
                } disabled:opacity-60`}
                disabled={isSubmitting}
              >
                {isSubmitting
                  ? 'Processing...'
                  : modal.type === 'delete-collection' || modal.type === 'delete-request'
                    ? 'Delete'
                    : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface CollectionItemProps {
  collection: Collection;
  isExpanded: boolean;
  onToggle: () => void;
  onOpenRequest: (request: ApiRequest) => void;
  onAddRequest: () => void;
  onContextMenu: (event: React.MouseEvent, type: 'collection' | 'request', id: string, collectionId?: string) => void;
  onViewDocs: () => void;
  onShareCollection: () => void;
  draggingRequest: { collectionId: string; requestId: string } | null;
  requestDropTarget: { collectionId: string; requestId: string } | null;
  onRequestDragStart: (collectionId: string, requestId: string, event: React.DragEvent) => void;
  onRequestDragOver: (collectionId: string, requestId: string, event: React.DragEvent) => void;
  onRequestDrop: (collectionId: string, requestId: string, event: React.DragEvent) => void;
  onRequestDragEnd: () => void;
  storageMode: 'local' | 'remote';
}

function CollectionItem({
  collection,
  isExpanded,
  onToggle,
  onOpenRequest,
  onAddRequest,
  onContextMenu,
  onViewDocs,
  onShareCollection,
  draggingRequest,
  requestDropTarget,
  onRequestDragStart,
  onRequestDragOver,
  onRequestDrop,
  onRequestDragEnd,
  storageMode,
}: CollectionItemProps) {
  const roleLabel = storageMode === 'remote' ? collection.currentUserRole : undefined;

  return (
    <div>
      <div className="flex items-center gap-1 px-2 py-1.5 hover:bg-app-hover cursor-pointer group" onClick={onToggle} onContextMenu={(event) => onContextMenu(event, 'collection', collection.id)}>
        {isExpanded ? <ChevronDown size={13} className="text-app-muted flex-shrink-0" /> : <ChevronRight size={13} className="text-app-muted flex-shrink-0" />}
        <FolderOpen size={13} className="text-app-accent flex-shrink-0" />
        <span className="text-sm text-app-text flex-1 truncate">{collection.name}</span>
        {roleLabel && (
          <span
            className={`hidden md:inline-flex items-center gap-1 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${
              roleLabel === 'owner'
                ? 'bg-orange-900/40 text-orange-300'
                : roleLabel === 'editor'
                  ? 'bg-blue-900/40 text-blue-300'
                  : 'bg-app-active text-app-muted'
            }`}
            title={`Your role: ${roleLabel}`}
          >
            {roleLabel}
          </span>
        )}
        <span className={`hidden sm:inline-flex items-center gap-1 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${collection.sharing.collection.access === 'public' ? 'bg-emerald-900/40 text-emerald-300' : 'bg-app-active text-app-muted'}`}>
          {collection.sharing.collection.access === 'public' ? <Globe2 size={10} /> : <Lock size={10} />}
          {collection.sharing.collection.access}
        </span>
        <div className="hidden group-hover:flex items-center gap-0.5 ml-auto">
          <button onClick={(event) => { event.stopPropagation(); onViewDocs(); }} className="p-0.5 hover:bg-app-active rounded text-app-muted hover:text-app-text" title="View docs">
            <Book size={11} />
          </button>
          {storageMode === 'remote' && (
            <button onClick={(event) => { event.stopPropagation(); onShareCollection(); }} className="p-0.5 hover:bg-app-active rounded text-app-muted hover:text-app-text" title="Share collection">
              <Share2 size={11} />
            </button>
          )}
          <button onClick={(event) => { event.stopPropagation(); onAddRequest(); }} className="p-0.5 hover:bg-app-active rounded text-app-muted hover:text-app-text" title="Add request">
            <Plus size={11} />
          </button>
          <button onClick={(event) => { event.stopPropagation(); onContextMenu(event, 'collection', collection.id); }} className="p-0.5 hover:bg-app-active rounded text-app-muted hover:text-app-text">
            <MoreHorizontal size={11} />
          </button>
        </div>
      </div>
      {isExpanded && (
        <div className="ml-6 border-l border-app-border">
          {collection.requests.length === 0 ? (
            <div className="flex items-center gap-2 px-3 py-2 text-xs text-app-muted cursor-pointer hover:bg-app-hover hover:text-app-accent" onClick={onAddRequest}>
              <Plus size={11} /> Add request
            </div>
          ) : (
            collection.requests.map((request) => (
              <RequestItem
                key={request.id}
                request={request}
                onOpen={() => onOpenRequest(request)}
                onContextMenu={(event) => onContextMenu(event, 'request', request.id, collection.id)}
                isDragging={draggingRequest?.collectionId === collection.id && draggingRequest.requestId === request.id}
                isDropTarget={requestDropTarget?.collectionId === collection.id && requestDropTarget.requestId === request.id}
                onDragStart={(event) => onRequestDragStart(collection.id, request.id, event)}
                onDragOver={(event) => onRequestDragOver(collection.id, request.id, event)}
                onDrop={(event) => onRequestDrop(collection.id, request.id, event)}
                onDragEnd={onRequestDragEnd}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

function RequestItem({
  request,
  onOpen,
  onContextMenu,
  isDragging,
  isDropTarget,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: {
  request: ApiRequest;
  onOpen: () => void;
  onContextMenu: (event: React.MouseEvent) => void;
  isDragging: boolean;
  isDropTarget: boolean;
  onDragStart: (event: React.DragEvent) => void;
  onDragOver: (event: React.DragEvent) => void;
  onDrop: (event: React.DragEvent) => void;
  onDragEnd: () => void;
}) {
  return (
    <div
      draggable
      className={`flex items-center gap-2 px-3 py-1.5 cursor-grab group border-l-2 ${
        isDropTarget
          ? 'bg-app-active border-app-accent'
          : 'hover:bg-app-hover border-transparent'
      } ${isDragging ? 'opacity-60' : ''}`}
      onClick={onOpen}
      onContextMenu={onContextMenu}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
    >
      <FileText size={11} className="text-app-muted flex-shrink-0" />
      <span className={`text-xs font-mono font-semibold w-12 flex-shrink-0 ${METHOD_COLORS[request.method] || 'text-app-muted'}`}>
        {request.method}
      </span>
      <span className="text-sm text-app-text truncate">{request.name}</span>
    </div>
  );
}