import { useState } from 'react';
import { useAppStore } from '../../store';
import { BodyType, KeyValuePair } from '../../types';
import { KVTable } from './ParamsTab';
import Editor from '@monaco-editor/react';
import { v4 as uuidv4 } from 'uuid';
import { Copy, Wand2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { beautifyContent, canBeautifyContent } from '../../utils/format';

const BODY_TYPES: { id: BodyType; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'json', label: 'JSON' },
  { id: 'xml', label: 'XML' },
  { id: 'text', label: 'Text' },
  { id: 'form-data', label: 'Form Data' },
  { id: 'form-urlencoded', label: 'URL Encoded' },
  { id: 'graphql', label: 'GraphQL' },
];

const BODY_LANG: Record<BodyType, string> = {
  none: 'plaintext',
  json: 'json',
  xml: 'xml',
  text: 'plaintext',
  'form-data': 'plaintext',
  'form-urlencoded': 'plaintext',
  graphql: 'graphql',
};

const JSON_PLACEHOLDER = `{
  "key": "value"
}`;

const GRAPHQL_PLACEHOLDER = `{
  "query": "{ users { id name email } }",
  "variables": {}
}`;

export default function BodyTab() {
  const { tabs, activeTabId, updateActiveRequest } = useAppStore();
  const tab = tabs.find((t) => t.id === activeTabId);
  if (!tab) return null;

  const req = tab.requestState.request;
  const { body } = req;

  const updateBody = (updates: Partial<typeof body>) => {
    updateActiveRequest({ body: { ...body, ...updates } });
  };

  const getPlaceholder = () => {
    if (body.type === 'json') return JSON_PLACEHOLDER;
    if (body.type === 'graphql') return GRAPHQL_PLACEHOLDER;
    if (body.type === 'xml') return '<root>\n  <key>value</key>\n</root>';
    return '';
  };

  const handleBeautify = () => {
    if (!canBeautifyContent(body.content || '', BODY_LANG[body.type])) {
      toast('Nothing to beautify for this body type');
      return;
    }

    const formatted = beautifyContent(body.content || '', BODY_LANG[body.type]);
    updateBody({ content: formatted });
    toast.success('Request body beautified');
  };

  const handleCopyBody = async () => {
    try {
      await navigator.clipboard.writeText(body.content || '');
      toast.success('Request body copied');
    } catch {
      toast.error('Failed to copy body');
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Body type selector */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-app-border bg-app-sidebar flex-shrink-0">
        <div className="flex items-center gap-1 overflow-x-auto">
          {BODY_TYPES.map((type) => (
            <button
              key={type.id}
              onClick={() => updateBody({ type: type.id })}
              className={`px-3 py-1 text-xs rounded transition-colors flex-shrink-0 ${
                body.type === type.id
                  ? 'bg-app-accent text-white'
                  : 'text-app-muted hover:text-app-text hover:bg-app-hover'
              }`}
            >
              {type.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleCopyBody}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border border-app-border text-app-muted hover:text-app-text hover:bg-app-hover transition-colors flex-shrink-0"
            title="Copy request body"
          >
            <Copy size={12} />
            Copy
          </button>
          {(body.type === 'json' || body.type === 'xml' || body.type === 'graphql') && (
            <button
              onClick={handleBeautify}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border border-app-border text-app-muted hover:text-app-text hover:bg-app-hover transition-colors flex-shrink-0"
              title="Beautify request body"
            >
              <Wand2 size={12} />
              Beautify
            </button>
          )}
        </div>
      </div>

      {/* Body Content */}
      <div className="flex-1 overflow-hidden">
        {body.type === 'none' && (
          <div className="flex items-center justify-center h-full text-app-muted text-sm">
            No body — select a body type above
          </div>
        )}

        {(body.type === 'json' || body.type === 'xml' || body.type === 'text' || body.type === 'graphql') && (
          <Editor
            height="100%"
            language={BODY_LANG[body.type]}
            value={body.content || getPlaceholder()}
            onChange={(val) => updateBody({ content: val || '' })}
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
        )}

        {(body.type === 'form-data' || body.type === 'form-urlencoded') && (
          <KVTable
            rows={body.formData || []}
            onChange={(formData) => updateBody({ formData })}
            keyPlaceholder="Field"
            valuePlaceholder="Value"
          />
        )}
      </div>
    </div>
  );
}
