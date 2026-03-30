import { useState } from 'react';
import { useAppStore } from '../../store';
import { Collection, ApiRequest, HttpMethod, RequestFormField } from '../../types';
import { X, Book, Copy, Share2, Globe2, Lock, Trash2 } from 'lucide-react';
import { METHOD_BG_COLORS } from '../../utils/format';
import CodeSnippetViewer from '../Common/CodeSnippetViewer';
import toast from 'react-hot-toast';
import { isFieldVisible } from '../../lib/requestForm';

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
              <>
                <button onClick={() => openShareModal(collection.id, 'docs')} className="btn-ghost text-xs inline-flex items-center gap-1.5">
                  <Share2 size={13} />
                  Share Docs
                </button>
                <button onClick={() => openShareModal(collection.id, 'form')} className="btn-ghost text-xs inline-flex items-center gap-1.5">
                  <Share2 size={13} />
                  Share Form
                </button>
              </>
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
  const bodyOnlyFields = (request.formConfig?.fields || []).filter(
    (field) => field.target === 'body-json' || field.target === 'body-form',
  );
  const [formValues, setFormValues] = useState<Record<string, string>>(() =>
    getInitialFormValues({
      ...request,
      formConfig: request.formConfig
        ? {
            ...request.formConfig,
            fields: bodyOnlyFields,
          }
        : request.formConfig,
    }),
  );

  const copyUrl = async () => {
    await navigator.clipboard.writeText(request.url);
    toast.success('URL copied');
  };

  const updateFormValue = (fieldName: string, value: string) => {
    setFormValues((previous) => ({
      ...previous,
      [fieldName]: value,
    }));
  };

  const groupedFields = groupVisibleFields(bodyOnlyFields, formValues);

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
          <DocSection title="Interactive Form">
            <div className="border border-app-border rounded p-3 space-y-3 bg-app-active/20">
              <p className="text-xs text-app-muted">User input preview from this form builder config.</p>
              {Object.entries(groupedFields).map(([groupName, fields]) => (
                <div key={`${request.id}-${groupName}`} className="space-y-2">
                  <p className="text-[11px] uppercase tracking-wider text-app-muted">{groupName}</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {fields.map((field) => (
                      <FormInputField
                        key={field.id}
                        field={field}
                        value={formValues[field.name] || ''}
                        onChange={(value) => updateFormValue(field.name, value)}
                      />
                    ))}
                  </div>
                </div>
              ))}

              {Object.keys(groupedFields).length === 0 && (
                <p className="text-xs text-app-muted">No visible fields with current values.</p>
              )}

            {request.formConfig.authRequirement?.enabled && (
              <p className="text-xs text-app-muted mt-2">
                Auth dependency: request must collect token from another request response before this endpoint is sent.
              </p>
            )}
            </div>
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

function getInitialFormValues(request: ApiRequest): Record<string, string> {
  const values: Record<string, string> = {};
  (request.formConfig?.fields || []).forEach((field) => {
    values[field.name] = field.defaultValue || '';
  });
  return values;
}

function groupVisibleFields(fields: RequestFormField[], values: Record<string, string>): Record<string, RequestFormField[]> {
  return fields.reduce<Record<string, RequestFormField[]>>((acc, field) => {
    if (!isFieldVisible(field, values)) {
      return acc;
    }

    const group = (field.group || 'General').trim() || 'General';
    if (!acc[group]) {
      acc[group] = [];
    }
    acc[group].push(field);
    return acc;
  }, {});
}

function FormInputField({
  field,
  value,
  onChange,
}: {
  field: RequestFormField;
  value: string;
  onChange: (value: string) => void;
}) {
  const inputClass = 'input-field mt-1 text-xs';

  return (
    <label className={`text-xs text-app-muted block ${field.layoutWidth === 'full' ? 'md:col-span-2' : ''}`}>
      <span className="inline-flex items-center gap-1">
        {field.label}
        {field.required && <span className="text-red-300">*</span>}
      </span>

      {field.type === 'textarea' || field.repeatable || field.type === 'json' || field.type === 'address' ? (
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={`${inputClass} min-h-20`}
          placeholder={field.placeholder || ''}
        />
      ) : field.type === 'select' ? (
        <select value={value} onChange={(event) => onChange(event.target.value)} className={`${inputClass} bg-app-panel`}>
          <option value="">Select...</option>
          {(field.options || []).map((option) => (
            <option key={option.id} value={option.value}>{option.label || option.value}</option>
          ))}
        </select>
      ) : field.type === 'radio' ? (
        <div className="mt-1 flex flex-wrap gap-2">
          {(field.options || []).map((option) => (
            <label key={option.id} className="inline-flex items-center gap-1">
              <input
                type="radio"
                name={`doc_form_${field.id}`}
                value={option.value}
                checked={value === option.value}
                onChange={(event) => onChange(event.target.value)}
                className="w-3.5 h-3.5 accent-orange-500"
              />
              <span>{option.label || option.value}</span>
            </label>
          ))}
        </div>
      ) : field.type === 'checkbox' ? (
        <input
          type="checkbox"
          checked={value === 'true'}
          onChange={(event) => onChange(event.target.checked ? 'true' : 'false')}
          className="mt-2 w-4 h-4 accent-orange-500"
        />
      ) : field.type === 'file' ? (
        <input
          type="file"
          multiple={Boolean(field.multiple)}
          accept={field.accept || undefined}
          onChange={(event) => {
            const files = event.target.files;
            if (!files || files.length === 0) {
              onChange('');
              return;
            }
            const fileNames = Array.from(files).map((file) => file.name).join(', ');
            onChange(fileNames);
          }}
          className="mt-1 text-xs text-app-muted"
        />
      ) : field.type === 'range' ? (
        <div className="mt-1 space-y-1">
          <input
            type="range"
            value={value || String(field.min ?? 0)}
            min={field.min}
            max={field.max}
            step={field.step}
            onChange={(event) => onChange(event.target.value)}
            className="w-full accent-orange-500"
          />
          <p className="text-[11px] text-app-muted">Value: {value || String(field.min ?? 0)}</p>
        </div>
      ) : (
        <input
          type={
            field.type === 'password'
              ? 'password'
              : field.type === 'number'
                ? 'number'
                : field.type === 'email'
                  ? 'email'
                  : field.type === 'tel'
                    ? 'tel'
                    : field.type === 'url'
                      ? 'url'
                      : field.type === 'date'
                        ? 'date'
                        : field.type === 'time'
                          ? 'time'
                          : field.type === 'datetime-local'
                            ? 'datetime-local'
                            : field.type === 'color'
                              ? 'color'
                              : 'text'
          }
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={field.placeholder || ''}
          min={field.min}
          max={field.max}
          step={field.step}
          pattern={field.pattern || undefined}
          className={inputClass}
        />
      )}

      <span className="block mt-1 text-[11px] text-app-muted font-mono">map: {field.target}{' -> '}{field.targetKey}</span>
      {field.description && <span className="block mt-1 text-[11px] text-app-muted">{field.description}</span>}
    </label>
  );
}