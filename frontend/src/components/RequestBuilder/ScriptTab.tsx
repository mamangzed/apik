import { useAppStore } from '../../store';
import Editor from '@monaco-editor/react';

interface ScriptTabProps {
  type: 'pre' | 'test';
}

const PRE_SCRIPT_EXAMPLE = `// Pre-request Script
// Available: apix.env, apix.request
// Example: set a variable
// apix.env.set("timestamp", Date.now().toString());

`;

const TEST_SCRIPT_EXAMPLE = `// Test Script
// Available: apix.response, apix.test, apix.expect

// apix.test("Status is 200", () => {
//   apix.expect(apix.response.status).toBe(200);
// });

// apix.test("Response has data", () => {
//   const body = JSON.parse(apix.response.body);
//   apix.expect(body.data).toBeDefined();
// });

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
        <span>{type === 'pre' ? 'Pre-Request Script' : 'Test Script'}</span>
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
