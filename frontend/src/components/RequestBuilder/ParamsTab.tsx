import { v4 as uuidv4 } from 'uuid';
import { useAppStore } from '../../store';
import { KeyValuePair } from '../../types';
import { Plus, Trash2, GripVertical } from 'lucide-react';

interface KVTableProps {
  rows: KeyValuePair[];
  onChange: (rows: KeyValuePair[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  filter?: string;
}

export function KVTable({ rows, onChange, keyPlaceholder = 'Key', valuePlaceholder = 'Value', filter }: KVTableProps) {
  const addRow = () => {
    onChange([...rows, { id: uuidv4(), key: '', value: '', description: '', enabled: true }]);
  };

  const updateRow = (id: string, field: keyof KeyValuePair, value: string | boolean) => {
    onChange(rows.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  };

  const removeRow = (id: string) => {
    onChange(rows.filter((r) => r.id !== id));
  };

  const q = filter?.toLowerCase().trim() ?? '';
  const displayRows = q
    ? rows.filter(
        (r) =>
          r.key.toLowerCase().includes(q) ||
          r.value.toLowerCase().includes(q) ||
          (r.description || '').toLowerCase().includes(q),
      )
    : rows;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-app-border bg-app-sidebar text-xs text-app-muted">
        <div className="w-5 flex-shrink-0" />
        <div className="w-5 flex-shrink-0" />
        <div className="flex-1">Key</div>
        <div className="flex-1">Value</div>
        <div className="flex-1 hidden lg:block">Description</div>
        <div className="w-8" />
      </div>

      {/* Rows */}
      <div className="flex-1 overflow-y-auto">
        {displayRows.map((row) => (
          <div key={row.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-app-hover/50 border-b border-app-border/50 group">
            <GripVertical size={13} className="text-app-muted/30 flex-shrink-0 cursor-grab" />
            <input
              type="checkbox"
              checked={row.enabled}
              onChange={(e) => updateRow(row.id, 'enabled', e.target.checked)}
              className="w-3.5 h-3.5 accent-orange-500 flex-shrink-0 cursor-pointer"
            />
            <input
              type="text"
              value={row.key}
              onChange={(e) => updateRow(row.id, 'key', e.target.value)}
              placeholder={keyPlaceholder}
              className={`flex-1 bg-transparent text-sm font-mono focus:outline-none placeholder-app-muted/50 ${row.enabled ? 'text-app-text' : 'text-app-muted line-through'}`}
            />
            <input
              type="text"
              value={row.value}
              onChange={(e) => updateRow(row.id, 'value', e.target.value)}
              placeholder={valuePlaceholder}
              className={`flex-1 bg-transparent text-sm font-mono focus:outline-none placeholder-app-muted/50 ${row.enabled ? 'text-app-text' : 'text-app-muted line-through'}`}
            />
            <input
              type="text"
              value={row.description || ''}
              onChange={(e) => updateRow(row.id, 'description', e.target.value)}
              placeholder="Description"
              className="flex-1 hidden lg:block bg-transparent text-sm text-app-muted focus:outline-none placeholder-app-muted/30"
            />
            <button
              onClick={() => removeRow(row.id)}
              className="opacity-0 group-hover:opacity-100 w-7 h-7 flex items-center justify-center hover:bg-red-900/30 hover:text-red-400 text-app-muted rounded transition-all"
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}

        {!q && (
          <button
            onClick={addRow}
            className="flex items-center gap-2 w-full px-3 py-2 text-sm text-app-muted hover:text-app-text hover:bg-app-hover transition-colors"
          >
            <Plus size={13} />
            Add {keyPlaceholder}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Params Tab ───────────────────────────────────────────────────────────────
export default function ParamsTab({ filter }: { filter?: string }) {
  const { tabs, activeTabId, updateActiveRequest } = useAppStore();
  const tab = tabs.find((t) => t.id === activeTabId);
  if (!tab) return null;

  return (
    <div className="h-full overflow-hidden">
      <KVTable
        rows={tab.requestState.request.params}
        onChange={(params) => updateActiveRequest({ params })}
        keyPlaceholder="Parameter"
        valuePlaceholder="Value"
        filter={filter}
      />
    </div>
  );
}
