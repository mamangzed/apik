import { useAppStore } from '../../store';
import { Collection, ApiRequest, HttpMethod } from '../../types';
import { X, Book, Copy, Share2, Globe2, Lock, Trash2 } from 'lucide-react';
import { METHOD_BG_COLORS } from '../../utils/format';
import CodeSnippetViewer from '../Common/CodeSnippetViewer';
import toast from 'react-hot-toast';

interface DocViewerProps {
  collectionId: string;
}

export default function DocViewer({ collectionId }: DocViewerProps) {
  const { collections, setShowDocViewer, openShareModal, storageMode, deleteMockExampleFromDocs } = useAppStore();
  const collection = collections.find((entry) => entry.id === collectionId);

  if (!collection) {
    return null;
  }

  const exportDocs = () => {
    const markdown = generateMarkdown(collection);
    const blob = new Blob([markdown], { type: 'text/markdown' });
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(blob);
    anchor.download = `${collection.name.replace(/\s+/g, '-')}-api-docs.md`;
    anchor.click();
    URL.revokeObjectURL(anchor.href);
    toast.success('Documentation exported');
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-end justify-center z-50" onClick={() => setShowDocViewer(false)}>
      <div className="bg-app-panel border border-app-border rounded-t-xl shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-app-border flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <Book size={16} className="text-app-accent" />
            <div className="min-w-0">
              <div className="font-semibold text-app-text truncate">{collection.name}</div>
              <div className="text-xs text-app-muted flex items-center gap-2">
                <span>API Documentation</span>
                <span className="inline-flex items-center gap-1">
                  {collection.sharing.docs.access === 'public' ? <Globe2 size={11} /> : <Lock size={11} />}
                  {collection.sharing.docs.access}
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {storageMode === 'remote' && (
              <button onClick={() => openShareModal(collection.id, 'docs')} className="btn-ghost text-xs inline-flex items-center gap-1.5">
                <Share2 size={13} />
                Share Docs
              </button>
            )}
            <button onClick={exportDocs} className="btn-primary text-xs py-1">
              Export Markdown
            </button>
            <button onClick={() => setShowDocViewer(false)} className="p-1.5 hover:bg-app-hover rounded text-app-muted hover:text-app-text">
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {collection.description && (
            <p className="text-app-muted text-sm mb-6 bg-app-active/50 border border-app-border rounded p-3">
              {collection.description}
            </p>
          )}

          {collection.requests.length === 0 ? (
            <div className="text-center py-12 text-app-muted">
              <Book size={40} className="mx-auto mb-3 opacity-20" />
              <p>No requests in this collection</p>
            </div>
          ) : (
            <div className="space-y-6">
              {collection.requests.map((request) => (
                <RequestDoc
                  key={request.id}
                  request={request}
                  collectionId={collection.id}
                  onDeleteExample={deleteMockExampleFromDocs}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function RequestDoc({
  request,
  collectionId,
  onDeleteExample,
}: {
  request: ApiRequest;
  collectionId: string;
  onDeleteExample: (collectionId: string, requestId: string, index: number) => Promise<void>;
}) {
  const copyUrl = async () => {
    await navigator.clipboard.writeText(request.url);
    toast.success('URL copied');
  };

  return (
    <div className="border border-app-border rounded-lg overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 bg-app-sidebar">
        <span className={`text-xs font-mono font-bold px-2.5 py-1 rounded ${METHOD_BG_COLORS[request.method as HttpMethod] || 'bg-app-active text-app-muted'}`}>
          {request.method}
        </span>
        <code className="flex-1 text-sm text-app-text font-mono truncate">{request.url || '/endpoint'}</code>
        <span className="text-sm font-medium text-app-text">{request.name}</span>
        <button onClick={copyUrl} className="p-1 hover:bg-app-hover rounded text-app-muted hover:text-app-text" title="Copy URL">
          <Copy size={13} />
        </button>
      </div>

      <div className="p-4 space-y-4">
        {request.description && <div className="text-sm text-app-muted leading-relaxed whitespace-pre-wrap">{request.description}</div>}

        {request.params.filter((param) => param.enabled && param.key).length > 0 && (
          <DocSection title="Query Parameters">
            <DocTable
              headers={['Parameter', 'Value', 'Description']}
              rows={request.params.filter((param) => param.enabled && param.key).map((param) => [
                <code key={param.id} className="text-blue-300">{param.key}</code>,
                <code key={`${param.id}-value`} className="text-green-300">{param.value || '–'}</code>,
                param.description || '–',
              ])}
            />
          </DocSection>
        )}

        {request.headers.filter((header) => header.enabled && header.key).length > 0 && (
          <DocSection title="Headers">
            <DocTable
              headers={['Header', 'Value', 'Description']}
              rows={request.headers.filter((header) => header.enabled && header.key).map((header) => [
                <code key={header.id} className="text-blue-300">{header.key}</code>,
                <code key={`${header.id}-value`} className="text-app-muted">{header.value || '–'}</code>,
                header.description || '–',
              ])}
            />
          </DocSection>
        )}

        {request.body.type !== 'none' && request.body.content && (
          <DocSection title={`Request Body (${request.body.type})`}>
            <CodeSnippetViewer content={request.body.content} contentType={request.body.type} />
          </DocSection>
        )}

        {request.formConfig?.enabled && (
          <DocSection title="Interactive Form Mapping">
            <DocTable
              headers={['Field', 'Type', 'Map To', 'Rules']}
              rows={(request.formConfig.fields || []).map((field) => [
                field.label,
                <code key={`${field.id}-type`} className="text-app-muted">{field.type}</code>,
                <code key={`${field.id}-map`} className="text-blue-300">{field.target}{' -> '}{field.targetKey}</code>,
                [
                  field.required ? 'required' : 'optional',
                  field.min !== undefined ? `min:${field.min}` : '',
                  field.max !== undefined ? `max:${field.max}` : '',
                  field.pattern ? 'pattern' : '',
                  field.type === 'select' || field.type === 'radio' ? `options:${(field.options || []).length}` : '',
                  field.repeatable ? `array:${field.repeatSeparator || 'newline'}` : '',
                  field.group ? `group:${field.group}` : '',
                  field.visibilityDependsOnFieldName ? `visible-if:${field.visibilityDependsOnFieldName}` : '',
                ].filter(Boolean).join(', '),
              ])}
            />
            {request.formConfig.authRequirement?.enabled && (
              <p className="text-xs text-app-muted mt-2">
                Auth dependency: request must collect token from another request response before this endpoint is sent.
              </p>
            )}
          </DocSection>
        )}

        {request.auth.type !== 'none' && (
          <DocSection title="Authentication">
            <p className="text-sm text-app-muted">
              Type: <span className="text-app-text font-medium">{request.auth.type}</span>
            </p>
          </DocSection>
        )}

        {(request.mockExamples || []).length > 0 && (
          <DocSection title="Response Examples">
            <div className="space-y-3">
              {(request.mockExamples || []).map((example, index) => (
                <div key={`${request.id}-example-${index}`} className="border border-app-border rounded overflow-hidden">
                  <div className="px-3 py-2 bg-app-active border-b border-app-border text-xs text-app-muted flex items-center gap-2">
                    <span>Example {index + 1}</span>
                    <span className="text-app-text font-medium">{example.status || 'ERR'} {example.statusText || ''}</span>
                    <span>{example.time}ms</span>
                    <span>{example.size} bytes</span>
                    <button
                      onClick={async () => {
                        try {
                          await onDeleteExample(collectionId, request.id, index);
                          toast.success('Response example removed');
                        } catch (error) {
                          toast.error(error instanceof Error ? error.message : 'Failed to remove response example');
                        }
                      }}
                      className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded border border-app-border hover:bg-app-hover text-app-text"
                      title="Delete response example"
                    >
                      <Trash2 size={11} /> Delete
                    </button>
                  </div>
                  <CodeSnippetViewer
                    content={example.body || ''}
                    contentType={example.headers?.['content-type'] || example.headers?.['Content-Type'] || ''}
                  />
                </div>
              ))}
            </div>
          </DocSection>
        )}
      </div>
    </div>
  );
}

function DocSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="text-xs font-semibold text-app-muted uppercase tracking-wider mb-2">{title}</h4>
      {children}
    </div>
  );
}

function DocTable({ headers, rows }: { headers: string[]; rows: (string | React.ReactNode)[][] }) {
  return (
    <div className="border border-app-border rounded overflow-hidden">
      <div className="flex items-center bg-app-active text-xs text-app-muted font-medium">
        {headers.map((header) => (
          <div key={header} className="flex-1 px-3 py-2">{header}</div>
        ))}
      </div>
      {rows.map((row, rowIndex) => (
        <div key={rowIndex} className="flex items-center border-t border-app-border/50 hover:bg-app-hover text-sm">
          {row.map((cell, cellIndex) => (
            <div key={cellIndex} className="flex-1 px-3 py-2">{cell}</div>
          ))}
        </div>
      ))}
    </div>
  );
}

function generateMarkdown(collection: Collection): string {
  const lines: string[] = [
    `# ${collection.name}`,
    '',
    collection.description || '',
    '',
    `> Generated by APIK on ${new Date().toLocaleDateString()}`,
    '',
    '---',
    '',
  ];

  collection.requests.forEach((request) => {
    lines.push(`## \`${request.method}\` ${request.url || '/endpoint'}`);
    lines.push('');
    if (request.name) lines.push(`**${request.name}**`);
    lines.push('');
    if (request.description) {
      lines.push(request.description);
      lines.push('');
    }

    const params = request.params.filter((param) => param.enabled && param.key);
    if (params.length > 0) {
      lines.push('### Query Parameters');
      lines.push('');
      lines.push('| Parameter | Value | Description |');
      lines.push('|-----------|-------|-------------|');
      params.forEach((param) => {
        lines.push(`| \`${param.key}\` | \`${param.value}\` | ${param.description || ''} |`);
      });
      lines.push('');
    }

    const headers = request.headers.filter((header) => header.enabled && header.key);
    if (headers.length > 0) {
      lines.push('### Headers');
      lines.push('');
      lines.push('| Header | Value |');
      lines.push('|--------|-------|');
      headers.forEach((header) => {
        lines.push(`| \`${header.key}\` | \`${header.value}\` |`);
      });
      lines.push('');
    }

    if (request.body.type !== 'none' && request.body.content) {
      lines.push(`### Request Body (\`${request.body.type}\`)`);
      lines.push('');
      lines.push('```' + (request.body.type === 'json' ? 'json' : request.body.type === 'xml' ? 'xml' : ''));
      lines.push(request.body.content);
      lines.push('```');
      lines.push('');
    }

    const responseExamples = request.mockExamples || [];
    if (responseExamples.length > 0) {
      lines.push('### Response Examples');
      lines.push('');
      responseExamples.forEach((example, index) => {
        lines.push(`#### Example ${index + 1} - ${example.status || 'ERR'} ${example.statusText || ''}`.trim());
        lines.push('');
        lines.push(`- Time: ${example.time}ms`);
        lines.push(`- Size: ${example.size} bytes`);
        lines.push('');
        lines.push('```');
        lines.push(example.body || '');
        lines.push('```');
        lines.push('');
      });
    }

    lines.push('---');
    lines.push('');
  });

  return lines.join('\n');
}