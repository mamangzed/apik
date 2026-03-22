import { useMemo, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useAppStore } from '../../store';
import { Environment, EnvVariable } from '../../types';
import {
  X,
  Plus,
  Trash2,
  Eye,
  EyeOff,
  Check,
} from 'lucide-react';
import toast from 'react-hot-toast';

type ResizableColumn = 'key' | 'initialValue' | 'currentValue' | 'type' | 'actions';

const MIN_MODAL_WIDTH = 900;
const MAX_MODAL_WIDTH = 1600;
const MIN_COLUMN_WIDTH: Record<ResizableColumn, number> = {
  key: 160,
  initialValue: 180,
  currentValue: 180,
  type: 84,
  actions: 88,
};

export default function EnvironmentModal() {
  const {
    environments,
    activeEnvironmentId,
    createEnvironment,
    updateEnvironment,
    deleteEnvironment,
    activateEnvironment,
    setShowEnvModal,
  } = useAppStore();

  const [selectedEnvId, setSelectedEnvId] = useState<string | null>(
    activeEnvironmentId || environments[0]?.id || null
  );
  const [editingVar, setEditingVar] = useState<string | null>(null);
  const [showSecrets, setShowSecrets] = useState<Set<string>>(new Set());
  const [newEnvName, setNewEnvName] = useState('');
  const [showNewEnvInput, setShowNewEnvInput] = useState(false);
  const [modalWidth, setModalWidth] = useState(1180);
  const [columnWidths, setColumnWidths] = useState<Record<ResizableColumn, number>>({
    key: 240,
    initialValue: 280,
    currentValue: 280,
    type: 100,
    actions: 120,
  });
  const isResizingRef = useRef(false);
  const suppressBackdropClickRef = useRef(false);

  const selectedEnv = environments.find((e) => e.id === selectedEnvId);
  const gridTemplateColumns = useMemo(
    () =>
      `24px ${columnWidths.key}px ${columnWidths.initialValue}px ${columnWidths.currentValue}px ${columnWidths.type}px ${columnWidths.actions}px`,
    [columnWidths],
  );

  const handleAddEnv = async () => {
    if (!newEnvName.trim()) return;
    await createEnvironment(newEnvName.trim());
    setNewEnvName('');
    setShowNewEnvInput(false);
    toast.success('Environment created');
  };

  const handleDeleteEnv = async (id: string) => {
    if (!confirm('Delete this environment?')) return;
    await deleteEnvironment(id);
    if (selectedEnvId === id) setSelectedEnvId(null);
    toast.success('Environment deleted');
  };

  const handleActivate = async (id: string) => {
    await activateEnvironment(id === activeEnvironmentId ? null : id);
    toast.success(id === activeEnvironmentId ? 'Environment deactivated' : 'Environment activated');
  };

  const updateVar = (varId: string, field: keyof EnvVariable, value: string | boolean) => {
    if (!selectedEnv) return;
    const updated: Environment = {
      ...selectedEnv,
      variables: selectedEnv.variables.map((v) =>
        v.id === varId ? { ...v, [field]: value } : v
      ),
    };
    updateEnvironment(updated);
  };

  const addVar = () => {
    if (!selectedEnv) return;
    const newVar: EnvVariable = {
      id: uuidv4(),
      key: '',
      value: '',
      initialValue: '',
      enabled: true,
      secret: false,
    };
    const updated: Environment = {
      ...selectedEnv,
      variables: [...selectedEnv.variables, newVar],
    };
    updateEnvironment(updated);
    setEditingVar(newVar.id);
  };

  const removeVar = (varId: string) => {
    if (!selectedEnv) return;
    const updated: Environment = {
      ...selectedEnv,
      variables: selectedEnv.variables.filter((v) => v.id !== varId),
    };
    updateEnvironment(updated);
  };

  const toggleShowSecret = (varId: string) => {
    setShowSecrets((prev) => {
      const next = new Set(prev);
      if (next.has(varId)) next.delete(varId);
      else next.add(varId);
      return next;
    });
  };

  const startModalResize = (startClientX: number, startWidth: number) => {
    isResizingRef.current = true;
    suppressBackdropClickRef.current = true;

    const onMouseMove = (event: MouseEvent) => {
      const delta = event.clientX - startClientX;
      const nextWidth = Math.max(MIN_MODAL_WIDTH, Math.min(MAX_MODAL_WIDTH, startWidth + delta));
      setModalWidth(nextWidth);
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      isResizingRef.current = false;
      setTimeout(() => {
        suppressBackdropClickRef.current = false;
      }, 0);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  const startColumnResize = (column: ResizableColumn, startClientX: number, startWidth: number) => {
    isResizingRef.current = true;
    suppressBackdropClickRef.current = true;

    const onMouseMove = (event: MouseEvent) => {
      const delta = event.clientX - startClientX;
      setColumnWidths((previous) => ({
        ...previous,
        [column]: Math.max(MIN_COLUMN_WIDTH[column], startWidth + delta),
      }));
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      isResizingRef.current = false;
      setTimeout(() => {
        suppressBackdropClickRef.current = false;
      }, 0);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  const renderResizableHeaderCell = (label: string, column: ResizableColumn, alignRight = false) => {
    return (
      <div className={`relative ${alignRight ? 'text-right' : ''}`}>
        <span>{label}</span>
        <button
          type="button"
          onMouseDown={(event) => {
            event.preventDefault();
            startColumnResize(column, event.clientX, columnWidths[column]);
          }}
          className="absolute top-[-6px] right-[-8px] h-7 w-3 cursor-col-resize rounded hover:bg-app-accent/30"
          title="Resize column"
          aria-label={`Resize ${label} column`}
        />
      </div>
    );
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
      onClick={() => {
        if (isResizingRef.current || suppressBackdropClickRef.current) {
          return;
        }
        setShowEnvModal(false);
      }}
    >
      <div
        className="relative bg-app-panel border border-app-border rounded-xl shadow-2xl max-h-[86vh] flex overflow-hidden"
        style={{ width: `min(${modalWidth}px, 96vw)` }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sidebar */}
        <div className="w-60 border-r border-app-border bg-app-sidebar flex flex-col">
          <div className="flex items-center justify-between px-3 py-3 border-b border-app-border">
            <span className="text-sm font-semibold text-app-text">Environments</span>
            <button
              onClick={() => setShowNewEnvInput(true)}
              className="p-1 hover:bg-app-hover rounded text-app-muted hover:text-app-text"
            >
              <Plus size={13} />
            </button>
          </div>

          {showNewEnvInput && (
            <div className="px-2 py-2 border-b border-app-border">
              <div className="flex gap-1">
                <input
                  autoFocus
                  type="text"
                  value={newEnvName}
                  onChange={(e) => setNewEnvName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleAddEnv();
                    if (e.key === 'Escape') setShowNewEnvInput(false);
                  }}
                  placeholder="Name..."
                  className="flex-1 bg-app-panel border border-app-border rounded px-2 py-1 text-xs text-app-text placeholder-app-muted focus:outline-none focus:border-app-accent"
                />
                <button onClick={handleAddEnv} className="p-1 hover:bg-green-900/30 text-green-400 rounded">
                  <Check size={13} />
                </button>
              </div>
            </div>
          )}

          <div className="flex-1 overflow-y-auto py-1">
            {environments.map((env) => (
              <div
                key={env.id}
                onClick={() => setSelectedEnvId(env.id)}
                className={`flex items-center gap-2 px-3 py-2.5 cursor-pointer group ${
                  selectedEnvId === env.id
                    ? 'bg-app-active border-l-2 border-app-accent'
                    : 'hover:bg-app-hover border-l-2 border-transparent'
                }`}
              >
                <div
                  className={`w-2 h-2 rounded-full flex-shrink-0 ${
                    env.id === activeEnvironmentId ? 'bg-green-400' : 'bg-app-muted/30'
                  }`}
                />
                <span className="text-sm text-app-text flex-1 truncate">{env.name}</span>
                <div className="hidden group-hover:flex gap-0.5">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleActivate(env.id);
                    }}
                    className="p-0.5 hover:bg-app-active rounded text-app-muted hover:text-green-400"
                    title={env.id === activeEnvironmentId ? 'Deactivate' : 'Activate'}
                  >
                    <Check size={11} />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteEnv(env.id);
                    }}
                    className="p-0.5 hover:bg-red-900/30 rounded text-app-muted hover:text-red-400"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Variables Editor */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-app-border">
            <div>
              <h2 className="text-base font-semibold text-app-text">
                {selectedEnv?.name || 'Select an Environment'}
              </h2>
              {selectedEnv && (
                <p className="text-xs text-app-muted">
                  {selectedEnv.id === activeEnvironmentId ? (
                    <span className="text-green-400">● Active</span>
                  ) : (
                    <span>● Inactive</span>
                  )}
                  {' '}· {selectedEnv.variables.length} variables
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              {selectedEnv && (
                <button
                  onClick={() => handleDeleteEnv(selectedEnv.id)}
                  className="px-3 py-1 text-xs rounded border border-red-500/40 text-red-300 hover:bg-red-900/30 transition-colors"
                >
                  Delete
                </button>
              )}
              {selectedEnv && (
                <button
                  onClick={() => handleActivate(selectedEnv.id)}
                  className={`btn-primary text-xs py-1 px-3 ${
                    selectedEnv.id === activeEnvironmentId ? 'opacity-70' : ''
                  }`}
                >
                  {selectedEnv.id === activeEnvironmentId ? 'Deactivate' : 'Activate'}
                </button>
              )}
              <button
                onClick={() => setShowEnvModal(false)}
                className="p-1.5 hover:bg-app-hover rounded text-app-muted hover:text-app-text"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {selectedEnv ? (
            <div className="flex-1 overflow-hidden flex flex-col">
              {/* Table header */}
              <div className="px-4 py-2 border-b border-app-border text-xs text-app-muted bg-app-sidebar flex-shrink-0 overflow-x-auto">
                <div className="grid gap-3 items-center min-w-max" style={{ gridTemplateColumns }}>
                  <div />
                  {renderResizableHeaderCell('Variable', 'key')}
                  {renderResizableHeaderCell('Initial Value', 'initialValue')}
                  {renderResizableHeaderCell('Current Value', 'currentValue')}
                  {renderResizableHeaderCell('Type', 'type')}
                  {renderResizableHeaderCell('Actions', 'actions', true)}
                </div>
              </div>

              {/* Variables */}
              <div className="flex-1 overflow-auto">
                {selectedEnv.variables.map((variable) => (
                  <div
                    key={variable.id}
                    className="px-4 py-2 border-b border-app-border/50 hover:bg-app-hover group"
                  >
                    <div className="grid gap-3 items-center min-w-max" style={{ gridTemplateColumns }}>
                      <input
                        type="checkbox"
                        checked={variable.enabled}
                        onChange={(e) => updateVar(variable.id, 'enabled', e.target.checked)}
                        className="w-3.5 h-3.5 accent-orange-500 flex-shrink-0"
                      />
                      <input
                        type="text"
                        value={variable.key}
                        onChange={(e) => updateVar(variable.id, 'key', e.target.value)}
                        placeholder="variable_name"
                        className="w-full bg-app-bg/40 border border-app-border/40 rounded px-2 py-1 text-sm font-mono text-blue-300 focus:outline-none focus:border-app-accent placeholder-app-muted/40 min-w-0"
                      />
                      <input
                        type={variable.secret && !showSecrets.has(variable.id) ? 'password' : 'text'}
                        value={variable.initialValue || ''}
                        onChange={(e) => updateVar(variable.id, 'initialValue', e.target.value)}
                        placeholder="initial value"
                        className="w-full bg-app-bg/40 border border-app-border/40 rounded px-2 py-1 text-sm font-mono text-app-muted focus:outline-none focus:border-app-accent placeholder-app-muted/30 min-w-0"
                      />
                      <input
                        type={variable.secret && !showSecrets.has(variable.id) ? 'password' : 'text'}
                        value={variable.value}
                        onChange={(e) => updateVar(variable.id, 'value', e.target.value)}
                        placeholder="current value"
                        className="w-full bg-app-bg/40 border border-app-border/40 rounded px-2 py-1 text-sm font-mono text-app-text focus:outline-none focus:border-app-accent placeholder-app-muted/30 min-w-0"
                      />
                      <div className="w-full flex items-center justify-center">
                        <button
                          onClick={() => updateVar(variable.id, 'secret', !variable.secret)}
                          className={`text-xs px-1.5 py-0.5 rounded ${
                            variable.secret
                              ? 'bg-yellow-900/40 text-yellow-300'
                              : 'bg-app-active text-app-muted'
                          }`}
                        >
                          {variable.secret ? 'Secret' : 'Default'}
                        </button>
                      </div>
                      <div className="w-full flex items-center justify-end gap-1">
                        {variable.secret && (
                          <button
                            onClick={() => toggleShowSecret(variable.id)}
                            className="p-0.5 hover:bg-app-active rounded text-app-muted hover:text-app-text"
                            title="Show/Hide value"
                          >
                            {showSecrets.has(variable.id) ? <EyeOff size={12} /> : <Eye size={12} />}
                          </button>
                        )}
                        <button
                          onClick={() => removeVar(variable.id)}
                          className="px-2 py-1 text-xs rounded border border-red-500/40 text-red-300 hover:bg-red-900/30 transition-colors"
                          title="Delete variable"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
                <button
                  onClick={addVar}
                  className="flex items-center gap-2 min-w-max px-4 py-2.5 text-sm text-app-muted hover:text-app-text hover:bg-app-hover transition-colors"
                >
                  <Plus size={13} />
                  Add Variable
                </button>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-app-muted text-sm">
              Select or create an environment
            </div>
          )}
        </div>

        <button
          type="button"
          onMouseDown={(event) => {
            event.preventDefault();
            startModalResize(event.clientX, modalWidth);
          }}
          className="absolute top-0 right-0 h-full w-2 cursor-ew-resize hover:bg-app-accent/30"
          title="Resize popup width"
          aria-label="Resize popup width"
        />
      </div>
    </div>
  );
}
