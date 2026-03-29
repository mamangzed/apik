import { useAppStore } from '../../store';
import Editor from '@monaco-editor/react';

interface ScriptTabProps {
  type: 'pre' | 'test';
}

const PRE_SCRIPT_EXAMPLE = `// Pre-request Script
// Available: apik.env, apik.request, apik.log
// Example: timestamp + dynamic auth header
const now = new Date().toISOString();
apik.env.set('request_time', now);

const token = apik.env.get('token');
if (token) {
  apik.request.setHeader('Authorization', 'Bearer ' + token);
}

// You can mutate URL/query too:
// apik.request.setQueryParam('ts', Date.now().toString());
apik.log('Pre-request executed at', now);

`;

const TEST_SCRIPT_EXAMPLE = `// Post-request Script
// Available: apik.response, apik.test, apik.expect, apik.env

apik.test('Status is 200', () => {
  apik.expect(apik.response.status).toBe(200);
});

apik.test('Response time under 1200ms', () => {
  apik.expect(apik.response.time).toBeLessThan(1200);
});

const json = apik.response.json();
if (json?.data?.token) {
  apik.env.set('last_api_token', json.data.token);
}

`;

export default function ScriptTab({ type }: ScriptTabProps) {
  const { tabs, activeTabId, updateActiveRequest } = useAppStore();
  const tab = tabs.find((t) => t.id === activeTabId);
  if (!tab) return null;

  const req = tab.requestState.request;
  const value = type === 'pre' ? req.preRequestScript : req.testScript;
  const placeholder = type === 'pre' ? PRE_SCRIPT_EXAMPLE : TEST_SCRIPT_EXAMPLE;

  const handleChange = (val: string | undefined) => {
    if (type === 'pre') updateActiveRequest({ preRequestScript: val || '' });
    else updateActiveRequest({ testScript: val || '' });
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-3 py-2 border-b border-app-border bg-app-sidebar text-xs text-app-muted flex items-center justify-between flex-shrink-0">
        <span>{type === 'pre' ? 'Pre-Request Script' : 'Post-Request Script'}</span>
        <span className="text-app-muted/50">JavaScript</span>
      </div>
      <div className="flex-1 overflow-hidden">
        <Editor
          height="100%"
          language="javascript"
          value={value || placeholder}
          onChange={handleChange}
          theme="vs-dark"
          options={{
            minimap: { enabled: false },
            fontSize: 13,
            fontFamily: 'JetBrains Mono, Fira Code, Consolas, monospace',
            lineNumbers: 'on',
            wordWrap: 'on',
            scrollBeyondLastLine: false,
            padding: { top: 8 },
            automaticLayout: true,
            tabSize: 2,
          }}
        />
      </div>
    </div>
  );
}
