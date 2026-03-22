import { useMemo } from 'react';
import Editor from '@monaco-editor/react';
import { detectLanguage, prettyPrint } from '../../utils/format';

type CodeSnippetViewerProps = {
  content: string;
  contentType?: string;
};

export default function CodeSnippetViewer({ content, contentType = '' }: CodeSnippetViewerProps) {
  const formatted = useMemo(() => prettyPrint(content || '', contentType), [content, contentType]);
  const language = useMemo(() => detectLanguage(contentType, formatted), [contentType, formatted]);

  const lineCount = formatted ? formatted.split('\n').length : 1;
  const height = Math.min(280, Math.max(96, lineCount * 20 + 12));

  return (
    <div className="border border-app-border rounded overflow-hidden bg-app-bg">
      <Editor
        height={`${height}px`}
        language={language}
        value={formatted}
        theme="vs-dark"
        options={{
          readOnly: true,
          minimap: { enabled: false },
          fontSize: 12,
          fontFamily: 'JetBrains Mono, Fira Code, Consolas, monospace',
          lineNumbers: 'off',
          wordWrap: 'on',
          scrollBeyondLastLine: false,
          padding: { top: 8 },
          automaticLayout: true,
        }}
      />
    </div>
  );
}
