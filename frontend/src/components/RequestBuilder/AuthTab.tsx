import { useAppStore } from '../../store';
import { AuthType } from '../../types';

const AUTH_TYPES: { id: AuthType; label: string }[] = [
  { id: 'none', label: 'No Auth' },
  { id: 'bearer', label: 'Bearer Token' },
  { id: 'basic', label: 'Basic Auth' },
  { id: 'api-key', label: 'API Key' },
  { id: 'oauth2', label: 'OAuth 2.0' },
];

export default function AuthTab() {
  const { tabs, activeTabId, updateActiveRequest } = useAppStore();
  const tab = tabs.find((t) => t.id === activeTabId);
  if (!tab) return null;

  const { auth } = tab.requestState.request;
  const updateAuth = (updates: Partial<typeof auth>) => {
    updateActiveRequest({ auth: { ...auth, ...updates } });
  };

  return (
    <div className="flex h-full overflow-hidden">
      {/* Auth type list */}
      <div className="w-44 border-r border-app-border bg-app-sidebar flex-shrink-0 overflow-y-auto">
        {AUTH_TYPES.map((type) => (
          <button
            key={type.id}
            onClick={() => updateAuth({ type: type.id })}
            className={`w-full text-left px-4 py-3 text-sm transition-colors border-l-2 ${
              auth.type === type.id
                ? 'border-app-accent bg-app-active text-app-text'
                : 'border-transparent text-app-muted hover:bg-app-hover hover:text-app-text'
            }`}
          >
            {type.label}
          </button>
        ))}
      </div>

      {/* Auth config */}
      <div className="flex-1 overflow-y-auto p-4">
        {auth.type === 'none' && (
          <p className="text-app-muted text-sm">No authentication configured.</p>
        )}

        {auth.type === 'bearer' && (
          <div className="space-y-3 max-w-lg">
            <h4 className="text-sm font-medium text-app-text mb-3">Bearer Token</h4>
            <label className="block">
              <span className="text-xs text-app-muted mb-1 block">Token</span>
              <input
                type="text"
                value={auth.token || ''}
                onChange={(e) => updateAuth({ token: e.target.value })}
                placeholder="Your bearer token or {{variable}}"
                className="input-field font-mono"
              />
            </label>
            <p className="text-xs text-app-muted">
              Adds <code className="bg-app-active px-1 rounded">Authorization: Bearer &lt;token&gt;</code> header
            </p>
          </div>
        )}

        {auth.type === 'basic' && (
          <div className="space-y-3 max-w-lg">
            <h4 className="text-sm font-medium text-app-text mb-3">Basic Authentication</h4>
            <label className="block">
              <span className="text-xs text-app-muted mb-1 block">Username</span>
              <input
                type="text"
                value={auth.username || ''}
                onChange={(e) => updateAuth({ username: e.target.value })}
                placeholder="username"
                className="input-field"
              />
            </label>
            <label className="block">
              <span className="text-xs text-app-muted mb-1 block">Password</span>
              <input
                type="password"
                value={auth.password || ''}
                onChange={(e) => updateAuth({ password: e.target.value })}
                placeholder="password"
                className="input-field"
              />
            </label>
          </div>
        )}

        {auth.type === 'api-key' && (
          <div className="space-y-3 max-w-lg">
            <h4 className="text-sm font-medium text-app-text mb-3">API Key</h4>
            <label className="block">
              <span className="text-xs text-app-muted mb-1 block">Key Name</span>
              <input
                type="text"
                value={auth.key || ''}
                onChange={(e) => updateAuth({ key: e.target.value })}
                placeholder="X-API-Key"
                className="input-field font-mono"
              />
            </label>
            <label className="block">
              <span className="text-xs text-app-muted mb-1 block">Value</span>
              <input
                type="text"
                value={auth.value || ''}
                onChange={(e) => updateAuth({ value: e.target.value })}
                placeholder="your-api-key or {{api_key}}"
                className="input-field font-mono"
              />
            </label>
            <label className="block">
              <span className="text-xs text-app-muted mb-1 block">Add to</span>
              <select
                value={auth.addTo || 'header'}
                onChange={(e) => updateAuth({ addTo: e.target.value as 'header' | 'query' })}
                className="input-field bg-app-panel"
              >
                <option value="header">Header</option>
                <option value="query">Query Param</option>
              </select>
            </label>
          </div>
        )}

        {auth.type === 'oauth2' && (
          <div className="max-w-lg">
            <h4 className="text-sm font-medium text-app-text mb-3">OAuth 2.0</h4>
            <p className="text-xs text-app-muted bg-app-panel border border-app-border rounded p-3">
              OAuth 2.0 flow — enter your token manually in the Token field below, or use environment variables like{' '}
              <code className="bg-app-active px-1 rounded">{'{{access_token}}'}</code>
            </p>
            <div className="mt-3">
              <label className="block">
                <span className="text-xs text-app-muted mb-1 block">Access Token</span>
                <input
                  type="text"
                  value={auth.token || ''}
                  onChange={(e) => updateAuth({ token: e.target.value })}
                  placeholder="{{access_token}}"
                  className="input-field font-mono"
                />
              </label>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
