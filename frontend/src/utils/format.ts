import { HttpMethod } from '../types';

export const METHOD_COLORS: Record<HttpMethod, string> = {
  GET: 'text-green-400',
  POST: 'text-orange-400',
  PUT: 'text-blue-400',
  PATCH: 'text-yellow-400',
  DELETE: 'text-red-400',
  HEAD: 'text-purple-400',
  OPTIONS: 'text-cyan-400',
};

export const METHOD_BG_COLORS: Record<HttpMethod, string> = {
  GET: 'bg-green-900/40 text-green-300',
  POST: 'bg-orange-900/40 text-orange-300',
  PUT: 'bg-blue-900/40 text-blue-300',
  PATCH: 'bg-yellow-900/40 text-yellow-300',
  DELETE: 'bg-red-900/40 text-red-300',
  HEAD: 'bg-purple-900/40 text-purple-300',
  OPTIONS: 'bg-cyan-900/40 text-cyan-300',
};

export function getStatusColor(status: number): string {
  if (status === 0) return 'text-red-400';
  if (status < 200) return 'text-blue-400';
  if (status < 300) return 'text-green-400';
  if (status < 400) return 'text-yellow-400';
  if (status < 500) return 'text-orange-400';
  return 'text-red-400';
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export function formatTime(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export function prettyPrint(content: string, contentType: string = ''): string {
  return beautifyContent(content, detectLanguage(contentType, content), contentType);
}

export function beautifyContent(content: string, language: string = 'plaintext', contentType: string = ''): string {
  if (!content.trim()) return content;

  if (language === 'json' || contentType.includes('json') || isJson(content)) {
    return formatJson(content);
  }

  if (language === 'xml' || contentType.includes('xml') || contentType.includes('html') || looksLikeXml(content)) {
    return formatXml(content);
  }

  if (language === 'graphql') {
    return formatGraphqlPayload(content);
  }

  if (language === 'javascript' || contentType.includes('javascript') || contentType.includes('ecmascript')) {
    return formatJavascript(content);
  }

  if (language === 'css' || contentType.includes('css')) {
    return formatCss(content);
  }

  return content;
}

export function canBeautifyContent(content: string, language: string = 'plaintext', contentType: string = ''): boolean {
  if (!content.trim()) return false;
  return (
    language === 'json' ||
    language === 'xml' ||
    language === 'graphql' ||
    language === 'javascript' ||
    language === 'css' ||
    contentType.includes('json') ||
    contentType.includes('xml') ||
    contentType.includes('html') ||
    contentType.includes('javascript') ||
    contentType.includes('ecmascript') ||
    contentType.includes('css') ||
    isJson(content) ||
    looksLikeXml(content)
  );
}

function formatJavascript(content: string): string {
  return formatBlockStructuredCode(content, { newlineAfterSemicolon: true });
}

function formatCss(content: string): string {
  return formatBlockStructuredCode(content, { newlineAfterSemicolon: true, newlineAfterComma: false });
}

function formatBlockStructuredCode(
  content: string,
  options: { newlineAfterSemicolon: boolean; newlineAfterComma?: boolean },
): string {
  const source = content.replace(/\r\n/g, '\n').trim();
  if (!source) return content;

  let indent = 0;
  let result = '';
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let inLineComment = false;
  let inBlockComment = false;
  let escaped = false;

  const appendIndent = () => {
    result += '  '.repeat(Math.max(indent, 0));
  };

  const appendNewlineIfNeeded = () => {
    if (!result.endsWith('\n')) {
      result += '\n';
    }
    while (result.endsWith(' \n')) {
      result = result.slice(0, -2) + '\n';
    }
  };

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1] || '';

    if (inLineComment) {
      result += char;
      if (char === '\n') {
        inLineComment = false;
        appendIndent();
      }
      continue;
    }

    if (inBlockComment) {
      result += char;
      if (char === '*' && next === '/') {
        result += '/';
        i += 1;
        inBlockComment = false;
      }
      continue;
    }

    if (inSingle || inDouble || inTemplate) {
      result += char;
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (inSingle && char === '\'') inSingle = false;
      if (inDouble && char === '"') inDouble = false;
      if (inTemplate && char === '`') inTemplate = false;
      continue;
    }

    if (char === '/' && next === '/') {
      inLineComment = true;
      result += '//';
      i += 1;
      continue;
    }

    if (char === '/' && next === '*') {
      inBlockComment = true;
      result += '/*';
      i += 1;
      continue;
    }

    if (char === '\'') {
      inSingle = true;
      result += char;
      continue;
    }

    if (char === '"') {
      inDouble = true;
      result += char;
      continue;
    }

    if (char === '`') {
      inTemplate = true;
      result += char;
      continue;
    }

    if (char === '{') {
      result = result.trimEnd();
      result += ' {';
      appendNewlineIfNeeded();
      indent += 1;
      appendIndent();
      continue;
    }

    if (char === '}') {
      indent = Math.max(indent - 1, 0);
      result = result.trimEnd();
      appendNewlineIfNeeded();
      appendIndent();
      result += '}';
      if (next && next !== ';' && next !== ',') {
        appendNewlineIfNeeded();
        appendIndent();
      }
      continue;
    }

    if (options.newlineAfterSemicolon && char === ';') {
      result += ';';
      appendNewlineIfNeeded();
      appendIndent();
      continue;
    }

    if (options.newlineAfterComma && char === ',') {
      result += ',\n';
      appendIndent();
      continue;
    }

    if (char === '\n') {
      if (!result.endsWith('\n')) {
        result += '\n';
        appendIndent();
      }
      continue;
    }

    result += char;
  }

  return result
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

function formatJson(content: string): string {
  try {
    return JSON.stringify(JSON.parse(content), null, 2);
  } catch {
    return content;
  }
}

function formatXml(content: string): string {
  try {
    const normalized = content
      .replace(/>\s*</g, '><')
      .replace(/(>)(<)(\/*)/g, '$1\n$2$3')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    let indent = 0;
    const lines: string[] = [];

    normalized.forEach((line) => {
      if (/^<\/.+>/.test(line)) {
        indent = Math.max(indent - 1, 0);
      }

      lines.push(`${'  '.repeat(indent)}${line}`);

      const isOpeningTag = /^<[^!?/][^>]*[^/]?>$/.test(line);
      const isClosingTag = /^<\/.+>/.test(line);
      const isSelfClosingTag = /\/\s*>$/.test(line);
      const isInlineNode = /^<([\w:-]+)(?:\s[^>]*)?>.*<\/\1>$/.test(line);

      if (isOpeningTag && !isClosingTag && !isSelfClosingTag && !isInlineNode) {
        indent += 1;
      }
    });

    return lines.join('\n');
  } catch {
    return content;
  }
}

function formatGraphqlPayload(content: string): string {
  try {
    const payload = JSON.parse(content) as Record<string, unknown>;
    if (typeof payload.query === 'string') {
      payload.query = formatGraphqlQuery(payload.query);
    }
    return JSON.stringify(payload, null, 2);
  } catch {
    return formatGraphqlQuery(content);
  }
}

function formatGraphqlQuery(content: string): string {
  const source = content.replace(/\s+/g, ' ').trim();
  if (!source) return content;

  let indent = 0;
  let result = '';

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];

    if (char === '{') {
      const needsSpace = result.length > 0 && !result.endsWith(' ') && !result.endsWith('\n');
      result += `${needsSpace ? ' ' : ''}{\n`;
      indent += 1;
      result += '  '.repeat(indent);
      continue;
    }

    if (char === '}') {
      indent = Math.max(indent - 1, 0);
      result = result.trimEnd();
      result += `\n${'  '.repeat(indent)}}`;
      if (source[index + 1] && source[index + 1] !== '}') {
        result += `\n${'  '.repeat(indent)}`;
      }
      continue;
    }

    if (char === ',') {
      result += ', ';
      continue;
    }

    result += char;
  }

  return result.replace(/\n{3,}/g, '\n\n').trim();
}

export function isJson(str: string): boolean {
  const trimmed = str.trim();
  return (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'));
}

function looksLikeXml(str: string): boolean {
  const trimmed = str.trim();
  return trimmed.startsWith('<') && trimmed.endsWith('>');
}

export function detectLanguage(contentType: string, body: string): string {
  if (contentType.includes('json') || isJson(body)) return 'json';
  if (contentType.includes('xml') || contentType.includes('html')) return 'xml';
  if (contentType.includes('javascript') || contentType.includes('ecmascript')) return 'javascript';
  if (contentType.includes('css')) return 'css';
  return 'plaintext';
}
