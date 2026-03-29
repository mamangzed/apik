import { useAppStore } from '../../store';
import { KVTable } from './ParamsTab';
import toast from 'react-hot-toast';

export default function HeadersTab({ filter }: { filter?: string }) {
  const { tabs, activeTabId, updateActiveRequest } = useAppStore();
  const tab = tabs.find((t) => t.id === activeTabId);
  if (!tab) return null;

  const copyAll = async () => {
    const enabled = tab.requestState.request.headers.filter((item) => item.enabled && item.key);
    const payload = enabled.reduce<Record<string, string>>((acc, item) => {
      acc[item.key] = item.value;
      return acc;
    }, {});
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      toast.success('Headers copied');
    } catch {
      toast.error('Failed to copy headers');
    }
  };

  return (
    <div className="h-full overflow-hidden">
      <KVTable
        rows={tab.requestState.request.headers}
        onChange={(headers) => updateActiveRequest({ headers })}
        keyPlaceholder="Header"
        valuePlaceholder="Value"
        filter={filter}
        onCopyAll={copyAll}
        copyLabel="Copy"
      />
    </div>
  );
}
