import { useAppStore } from '../../store';

export default function DocsTab() {
  const { tabs, activeTabId, updateActiveRequest } = useAppStore();
  const tab = tabs.find((entry) => entry.id === activeTabId);

  if (!tab) {
    return null;
  }

  const request = tab.requestState.request;

  return (
    <div className="flex flex-col h-full overflow-auto p-4">
      <div className="max-w-4xl w-full space-y-4 pb-8">
        <div>
          <label className="block text-xs text-app-muted mb-1">Request Description (Markdown)</label>
          <textarea
            value={request.description || ''}
            onChange={(event) => updateActiveRequest({ description: event.target.value })}
            placeholder="# Endpoint Description

Describe what this endpoint does, parameters, and response examples.

## Parameters
- `id` - The user ID

## Response
Returns a JSON object with user data."
            rows={12}
            className="input-field font-mono text-xs resize-none"
          />
        </div>

        <div className="border border-app-border rounded p-3 bg-app-active/20">
          <p className="text-xs font-medium text-app-text">Form Builder moved to a dedicated tab</p>
          <p className="text-[11px] text-app-muted mt-1">
            Open the <strong>Form</strong> tab next to Docs to design form layout with drag and drop.
          </p>
        </div>
      </div>
    </div>
  );
}
