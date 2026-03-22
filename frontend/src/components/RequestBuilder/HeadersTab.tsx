import { useAppStore } from '../../store';
import { KVTable } from './ParamsTab';

export default function HeadersTab({ filter }: { filter?: string }) {
  const { tabs, activeTabId, updateActiveRequest } = useAppStore();
  const tab = tabs.find((t) => t.id === activeTabId);
  if (!tab) return null;

  return (
    <div className="h-full overflow-hidden">
      <KVTable
        rows={tab.requestState.request.headers}
        onChange={(headers) => updateActiveRequest({ headers })}
        keyPlaceholder="Header"
        valuePlaceholder="Value"
        filter={filter}
      />
    </div>
  );
}
