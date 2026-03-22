import { useAppStore } from '../../store';

export default function DocsTab() {
  const { tabs, activeTabId, updateActiveRequest } = useAppStore();
  const tab = tabs.find((t) => t.id === activeTabId);
  if (!tab) return null;

  const req = tab.requestState.request;

  return (
    <div className="flex flex-col h-full overflow-hidden p-4">
      <div className="max-w-2xl w-full space-y-4">
        <div>
          <label className="block text-xs text-app-muted mb-1">Request Description (Markdown)</label>
          <textarea
            value={req.description || ''}
            onChange={(e) => updateActiveRequest({ description: e.target.value })}
            placeholder="# Endpoint Description

Describe what this endpoint does, its parameters, and expected responses.

## Parameters
- `id` - The user ID

## Response
Returns a JSON object with user data."
            rows={12}
            className="input-field font-mono text-xs resize-none"
          />
        </div>
        <p className="text-xs text-app-muted">
          This description will appear in the API documentation viewer.
          Supports Markdown formatting.
        </p>
      </div>
    </div>
  );
}
