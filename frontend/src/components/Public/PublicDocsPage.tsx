import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Book } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { apiClient } from '../../lib/apiClient';
import { PublicCollectionResponse } from '../../types';
import { METHOD_BG_COLORS } from '../../utils/format';
import CodeSnippetViewer from '../Common/CodeSnippetViewer';

function MarkdownBlock({ content }: { content: string }) {
  const normalized = content
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '  ');

  return (
    <div className="text-sm text-app-muted max-w-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h1 className="text-2xl font-semibold text-app-text mt-3 mb-2">{children}</h1>,
          h2: ({ children }) => <h2 className="text-xl font-semibold text-app-text mt-3 mb-2">{children}</h2>,
          h3: ({ children }) => <h3 className="text-lg font-semibold text-app-text mt-3 mb-2">{children}</h3>,
          p: ({ children }) => <p className="my-2 leading-6 text-app-muted">{children}</p>,
          ul: ({ children }) => <ul className="list-disc ml-5 my-2 space-y-1">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal ml-5 my-2 space-y-1">{children}</ol>,
          li: ({ children }) => <li className="text-app-muted">{children}</li>,
          a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer" className="text-blue-300 underline">{children}</a>,
          code: ({ children }) => <code className="px-1 py-0.5 rounded bg-app-active text-emerald-300 font-mono text-xs">{children}</code>,
          pre: ({ children }) => <pre className="my-2 p-3 rounded bg-app-active overflow-x-auto">{children}</pre>,
          blockquote: ({ children }) => <blockquote className="border-l-2 border-app-accent pl-3 text-app-muted italic my-2">{children}</blockquote>,
          hr: () => <hr className="my-3 border-app-border" />,
        }}
      >
        {normalized}
      </ReactMarkdown>
    </div>
  );
}

export default function PublicDocsPage() {
  const { token } = useParams();
  const [collection, setCollection] = useState<PublicCollectionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const root = document.getElementById('root');

    const prevHtmlOverflow = html.style.overflow;
    const prevBodyOverflow = body.style.overflow;
    const prevRootOverflow = root?.style.overflow || '';
    const prevRootHeight = root?.style.height || '';

    html.style.overflow = 'auto';
    body.style.overflow = 'auto';
    if (root) {
      root.style.overflow = 'visible';
      root.style.height = 'auto';
    }

    return () => {
      html.style.overflow = prevHtmlOverflow;
      body.style.overflow = prevBodyOverflow;
      if (root) {
        root.style.overflow = prevRootOverflow;
        root.style.height = prevRootHeight;
      }
    };
  }, []);

  useEffect(() => {
    const blockContextMenu = (event: MouseEvent) => {
      event.preventDefault();
    };

    const handleShortcut = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const ctrlOrMeta = event.ctrlKey || event.metaKey;

      if (key === 'f5' || key === 'f12' || (event.altKey && (key === 'arrowleft' || key === 'arrowright'))) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        return;
      }

      if (ctrlOrMeta && event.shiftKey && (key === 'c' || key === 'i' || key === 'j')) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        return;
      }

      if (!ctrlOrMeta) {
        return;
      }

      if (key === 'a' || key === 'c' || key === 'x' || key === 'v' || key === 'z' || key === 'y') {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    };

    window.addEventListener('contextmenu', blockContextMenu);
    document.addEventListener('keydown', handleShortcut, true);

    return () => {
      window.removeEventListener('contextmenu', blockContextMenu);
      document.removeEventListener('keydown', handleShortcut, true);
    };
  }, []);

  useEffect(() => {
    const load = async () => {
      try {
        const { data } = await apiClient.get<PublicCollectionResponse>(`/public/docs/${token}`);
        setCollection(data);
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : 'Failed to load shared docs');
      }
    };

    load();
  }, [token]);

  if (error) {
    return <div className="min-h-screen bg-app-bg text-app-text flex items-center justify-center">{error}</div>;
  }

  if (!collection) {
    return <div className="min-h-screen bg-app-bg text-app-text flex items-center justify-center">Loading documentation...</div>;
  }

  return (
    <div className="min-h-screen bg-app-bg text-app-text">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-5 sm:space-y-6">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-app-muted hover:text-app-text">
          <ArrowLeft size={14} />
          Open app
        </Link>

        <div className="panel p-4 sm:p-6">
          <div className="flex items-center gap-3">
            <Book size={18} className="text-app-accent" />
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-app-muted">Shared API Docs</p>
              <h1 className="text-2xl sm:text-3xl font-semibold mt-2 break-words">{collection.name}</h1>
            </div>
          </div>
          {collection.description && (
            <div className="mt-4 max-w-3xl">
              <MarkdownBlock content={collection.description} />
            </div>
          )}
        </div>

        <div className="space-y-5">
          {collection.requests.map((request) => (
            <div key={request.id} className="panel overflow-hidden">
              <div className="flex items-start sm:items-center gap-3 px-4 sm:px-5 py-4 bg-app-sidebar border-b border-app-border">
                <span className={`text-xs font-mono font-bold px-2.5 py-1 rounded ${METHOD_BG_COLORS[request.method]}`}>
                  {request.method}
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-medium break-words">{request.name}</div>
                  <div className="text-xs text-app-muted truncate">{request.url || '/endpoint'}</div>
                </div>
              </div>
              <div className="p-4 sm:p-5 space-y-4">
                {request.description && <MarkdownBlock content={request.description} />}
                {request.headers.filter((header) => header.enabled && header.key).length > 0 && (
                  <div>
                    <div className="text-xs uppercase tracking-wider text-app-muted mb-2">Headers</div>
                    <div className="rounded border border-app-border overflow-hidden">
                      {request.headers.filter((header) => header.enabled && header.key).map((header) => (
                        <div key={header.id} className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 px-4 py-2 text-sm border-t border-app-border first:border-t-0">
                          <span className="text-blue-300 font-mono sm:min-w-32 break-all">{header.key}</span>
                          <span className="text-app-muted font-mono break-all">{header.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {request.body.type !== 'none' && request.body.content && (
                  <div>
                    <div className="text-xs uppercase tracking-wider text-app-muted mb-2">Request Body</div>
                    <CodeSnippetViewer content={request.body.content} contentType={request.body.type} />
                  </div>
                )}

                {request.formConfig?.enabled && (
                  <div>
                    <div className="text-xs uppercase tracking-wider text-app-muted mb-2">Interactive Form</div>
                    <div className="rounded border border-app-border overflow-hidden">
                      {(request.formConfig.fields || []).map((field) => (
                        <div key={field.id} className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 px-4 py-2 text-sm border-t border-app-border first:border-t-0">
                          <span className="text-blue-300 font-mono sm:min-w-32 break-all">{field.label}</span>
                          <span className="text-app-muted font-mono break-all">{field.type} | {field.target} -> {field.targetKey}</span>
                          {field.group && <span className="text-[11px] text-cyan-300">group:{field.group}</span>}
                          {field.required && <span className="text-[11px] text-red-300">required</span>}
                          {field.repeatable && <span className="text-[11px] text-amber-300">array:{field.repeatSeparator || 'newline'}</span>}
                          {field.visibilityDependsOnFieldName && (
                            <span className="text-[11px] text-app-muted">visible-if:{field.visibilityDependsOnFieldName}</span>
                          )}
                        </div>
                      ))}
                    </div>
                    {request.formConfig.authRequirement?.enabled && (
                      <p className="mt-2 text-xs text-app-muted">
                        Requires auth dependency from another request before sending.
                      </p>
                    )}
                  </div>
                )}

                {(request.mockExamples || []).length > 0 && (
                  <div>
                    <div className="text-xs uppercase tracking-wider text-app-muted mb-2">Response Examples</div>
                    <div className="space-y-3">
                      {(request.mockExamples || []).map((example, index) => (
                        <div key={`${request.id}-public-example-${index}`} className="rounded border border-app-border overflow-hidden">
                          <div className="px-3 py-2 bg-app-active border-b border-app-border text-xs text-app-muted flex items-center gap-2">
                            <span>Example {index + 1}</span>
                            <span className="text-app-text font-medium">{example.status || 'ERR'} {example.statusText || ''}</span>
                            <span>{example.time}ms</span>
                            <span>{example.size} bytes</span>
                          </div>
                          <CodeSnippetViewer
                            content={example.body || ''}
                            contentType={example.headers?.['content-type'] || example.headers?.['Content-Type'] || ''}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}