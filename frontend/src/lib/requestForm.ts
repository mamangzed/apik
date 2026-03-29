import {
  ApiRequest,
  KeyValuePair,
  ProxyResponse,
  RequestFormConfig,
  RequestFormField,
  RequestFormFieldTarget,
} from '../types';

function createId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function toLabel(value: string): string {
  return value
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function normalizeName(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

function inferFieldTypeFromKey(key: string): RequestFormField['type'] {
  const lower = key.toLowerCase();

  if (lower.includes('password') || lower === 'pass') return 'password';
  if (lower.includes('email')) return 'email';
  if (lower.includes('phone') || lower.includes('tel') || lower.includes('mobile')) return 'tel';
  if (lower.includes('url') || lower.includes('website') || lower.includes('link')) return 'url';
  if (lower.includes('date')) return 'date';
  if (lower.includes('time')) return 'time';
  if (lower.includes('color') || lower.includes('colour')) return 'color';
  if (lower.includes('address') || lower.includes('addr')) return 'address';
  if (lower.includes('age') || lower.includes('count') || lower.includes('qty') || lower.includes('quantity')) {
    return 'number';
  }

  return 'text';
}

function createField(target: RequestFormFieldTarget, targetKey: string, type: RequestFormField['type'] = 'text'): RequestFormField {
  const safeTargetKey = targetKey.trim() || 'value';
  const baseName = normalizeName(`${target}_${safeTargetKey}`) || `field_${Math.random().toString(36).slice(2, 6)}`;
  return {
    id: createId('form_field'),
    name: baseName,
    label: toLabel(safeTargetKey),
    type,
    required: false,
    target,
    targetKey: safeTargetKey,
    placeholder: '',
    defaultValue: '',
    description: '',
    options: [],
    min: undefined,
    max: undefined,
    step: undefined,
    pattern: '',
    accept: '',
    multiple: false,
    repeatable: false,
    repeatSeparator: 'newline',
    group: target === 'body-json' || target === 'body-form' ? 'Request Body' : target === 'header' ? 'Headers' : target === 'param' ? 'Params' : 'Authentication',
    visibilityDependsOnFieldName: '',
    visibilityOperator: 'equals',
    visibilityValue: '',
  };
}

function parseRepeatableValue(rawValue: string, separator: 'newline' | 'comma' | 'json-lines' = 'newline'): string[] {
  if (separator === 'json-lines') {
    return rawValue
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  const chunks = separator === 'comma' ? rawValue.split(',') : rawValue.split(/\r?\n/);
  return chunks.map((item) => item.trim()).filter(Boolean);
}

function parseJsonLines(rawValue: string): unknown[] {
  return rawValue
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export function isFieldVisible(field: RequestFormField, values: Record<string, string>): boolean {
  const dependsOn = (field.visibilityDependsOnFieldName || '').trim();
  if (!dependsOn) {
    return true;
  }

  const source = String(values[dependsOn] || '');
  const expected = String(field.visibilityValue || '');
  const operator = field.visibilityOperator || 'equals';

  if (operator === 'filled') return source.trim().length > 0;
  if (operator === 'not-filled') return source.trim().length === 0;
  if (operator === 'contains') return source.includes(expected);
  if (operator === 'not-equals') return source !== expected;
  return source === expected;
}

function parseJsonBodyFieldPaths(content: string): string[] {
  if (!content || !content.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(content) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return [];
    }

    const paths: string[] = [];
    const walk = (value: unknown, prefix = '') => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        if (prefix) {
          paths.push(prefix);
        }
        return;
      }

      const entries = Object.entries(value as Record<string, unknown>);
      if (entries.length === 0 && prefix) {
        paths.push(prefix);
        return;
      }

      entries.forEach(([key, nested]) => {
        const next = prefix ? `${prefix}.${key}` : key;
        if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
          walk(nested, next);
          return;
        }
        paths.push(next);
      });
    };

    walk(parsed);
    return Array.from(new Set(paths));
  } catch {
    return [];
  }
}

function defaultTokenPath(responseBody: string): string {
  try {
    const parsed = JSON.parse(responseBody) as Record<string, unknown>;
    if (typeof parsed.token === 'string') return 'token';
    if (typeof parsed.access_token === 'string') return 'access_token';
    if (parsed.data && typeof parsed.data === 'object' && parsed.data !== null) {
      const nested = parsed.data as Record<string, unknown>;
      if (typeof nested.token === 'string') return 'data.token';
      if (typeof nested.access_token === 'string') return 'data.access_token';
    }
  } catch {
    // Ignore response parse failures and use a practical default.
  }

  return 'token';
}

export function createAutoFormConfigFromRequest(request: ApiRequest): RequestFormConfig {
  const fields: RequestFormField[] = [];

  request.params
    .filter((param) => param.enabled && param.key)
    .forEach((param) => fields.push(createField('param', param.key, inferFieldTypeFromKey(param.key))));

  request.headers
    .filter((header) => header.enabled && header.key)
    .forEach((header) => {
      if (header.key.toLowerCase() === 'authorization') {
        return;
      }
      fields.push(createField('header', header.key, inferFieldTypeFromKey(header.key)));
    });

  if (request.body.type === 'json') {
    parseJsonBodyFieldPaths(request.body.content).forEach((path) => {
      fields.push(createField('body-json', path, inferFieldTypeFromKey(path)));
    });
  }

  if (request.body.type === 'form-data' || request.body.type === 'form-urlencoded') {
    (request.body.formData || [])
      .filter((entry) => entry.enabled && entry.key)
      .forEach((entry) => fields.push(createField('body-form', entry.key, inferFieldTypeFromKey(entry.key))));
  }

  if (request.auth.type === 'bearer') {
    fields.push(createField('auth-token', 'token', 'password'));
  }
  if (request.auth.type === 'basic') {
    fields.push(createField('auth-username', 'username', 'text'));
    fields.push(createField('auth-password', 'password', 'password'));
  }
  if (request.auth.type === 'api-key') {
    fields.push(createField('auth-api-key-value', request.auth.key || 'api_key', 'password'));
  }

  return {
    enabled: true,
    fields,
    authRequirement: {
      enabled: false,
      sourceRequestId: '',
      tokenPath: 'token',
      scheme: 'Bearer',
      headerName: 'Authorization',
    },
    responseMappings: [],
    scripts: {
      beforeSubmit: '',
      afterResponse: '',
    },
  };
}

function cloneRequest(request: ApiRequest): ApiRequest {
  return {
    ...request,
    params: request.params.map((entry) => ({ ...entry })),
    headers: request.headers.map((entry) => ({ ...entry })),
    body: {
      ...request.body,
      formData: request.body.formData?.map((entry) => ({ ...entry })),
    },
    auth: { ...request.auth },
    formConfig: request.formConfig
      ? {
          ...request.formConfig,
          fields: request.formConfig.fields.map((field) => ({
            ...field,
            options: field.options?.map((option) => ({ ...option })) || [],
          })),
          responseMappings: request.formConfig.responseMappings?.map((mapping) => ({ ...mapping })) || [],
          scripts: request.formConfig.scripts ? { ...request.formConfig.scripts } : undefined,
          authRequirement: request.formConfig.authRequirement ? { ...request.formConfig.authRequirement } : undefined,
        }
      : undefined,
  };
}

function upsertKeyValuePair(rows: KeyValuePair[], key: string, value: string): KeyValuePair[] {
  const existing = rows.find((row) => row.key === key);
  if (existing) {
    return rows.map((row) => (row.key === key ? { ...row, value, enabled: true } : row));
  }

  return [
    ...rows,
    {
      id: createId('row'),
      key,
      value,
      description: '',
      enabled: true,
    },
  ];
}

function setObjectPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split('.').map((segment) => segment.trim()).filter(Boolean);
  if (segments.length === 0) {
    return;
  }

  let cursor: Record<string, unknown> = target;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const isLast = index === segments.length - 1;
    if (isLast) {
      cursor[segment] = value;
      return;
    }

    const next = cursor[segment];
    if (!next || typeof next !== 'object' || Array.isArray(next)) {
      cursor[segment] = {};
    }
    cursor = cursor[segment] as Record<string, unknown>;
  }
}

function getPathValue(source: unknown, path: string): unknown {
  if (!path.trim()) {
    return source;
  }

  const segments = path.split('.').map((segment) => segment.trim()).filter(Boolean);
  let cursor: unknown = source;
  for (const segment of segments) {
    if (!cursor || typeof cursor !== 'object') {
      return undefined;
    }

    cursor = (cursor as Record<string, unknown>)[segment];
  }

  return cursor;
}

export function extractResponseValue(response: ProxyResponse | undefined, path: string): string {
  if (!response) {
    return '';
  }

  if (!path.trim()) {
    return response.body || '';
  }

  try {
    const parsed = JSON.parse(response.body) as unknown;
    const value = getPathValue(parsed, path);
    if (value === null || value === undefined) {
      return '';
    }
    if (typeof value === 'string') {
      return value;
    }
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

export function applyResponseMappings(
  values: Record<string, string>,
  config: RequestFormConfig | undefined,
  responses: Record<string, ProxyResponse>,
): Record<string, string> {
  if (!config?.responseMappings?.length) {
    return values;
  }

  const nextValues = { ...values };
  config.responseMappings.forEach((mapping) => {
    const sourceResponse = responses[mapping.sourceRequestId];
    const extracted = extractResponseValue(sourceResponse, mapping.responsePath);
    if (!extracted) {
      return;
    }

    const field = config.fields.find((entry) => entry.id === mapping.targetFieldId);
    if (!field) {
      return;
    }

    nextValues[field.name] = extracted;
  });

  return nextValues;
}

function normalizeFieldValue(rawValue: string, field: RequestFormField): string | number | boolean {
  if (field.repeatable) {
    if (field.repeatSeparator === 'json-lines') {
      try {
        return JSON.stringify(parseJsonLines(rawValue));
      } catch {
        return JSON.stringify(parseRepeatableValue(rawValue, field.repeatSeparator));
      }
    }
    return JSON.stringify(parseRepeatableValue(rawValue, field.repeatSeparator || 'newline'));
  }

  if (field.type === 'number' || field.type === 'range') {
    const parsed = Number(rawValue);
    return Number.isFinite(parsed) ? parsed : rawValue;
  }

  if (field.type === 'checkbox') {
    return rawValue === 'true';
  }

  if (field.type === 'address') {
    try {
      const parsed = JSON.parse(rawValue) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return JSON.stringify(parsed);
      }
    } catch {
      return rawValue;
    }
  }

  if (field.type === 'json') {
    try {
      const parsed = JSON.parse(rawValue) as unknown;
      return JSON.stringify(parsed);
    } catch {
      return rawValue;
    }
  }

  return rawValue;
}

function validateFieldValue(field: RequestFormField, fieldValue: string): string | null {
  const value = String(fieldValue || '');
  const trimmed = value.trim();

  if (field.required && !trimmed) {
    return `Field \"${field.label}\" is required.`;
  }

  if (!trimmed) {
    return null;
  }

  if (field.type === 'email') {
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(trimmed)) {
      return `Field \"${field.label}\" must be a valid email.`;
    }
  }

  if (field.type === 'url') {
    try {
      new URL(trimmed);
    } catch {
      return `Field \"${field.label}\" must be a valid URL.`;
    }
  }

  if (field.type === 'date') {
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    if (!datePattern.test(trimmed)) {
      return `Field \"${field.label}\" must use date format YYYY-MM-DD.`;
    }
  }

  if (field.type === 'time') {
    const timePattern = /^\d{2}:\d{2}(:\d{2})?$/;
    if (!timePattern.test(trimmed)) {
      return `Field \"${field.label}\" must use time format HH:mm or HH:mm:ss.`;
    }
  }

  if (field.type === 'datetime-local') {
    const dtPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;
    if (!dtPattern.test(trimmed)) {
      return `Field \"${field.label}\" must use datetime-local format YYYY-MM-DDTHH:mm.`;
    }
  }

  if (field.type === 'number' || field.type === 'range') {
    const num = Number(trimmed);
    if (!Number.isFinite(num)) {
      return `Field \"${field.label}\" must be a valid number.`;
    }
    if (field.min !== undefined && num < field.min) {
      return `Field \"${field.label}\" must be >= ${field.min}.`;
    }
    if (field.max !== undefined && num > field.max) {
      return `Field \"${field.label}\" must be <= ${field.max}.`;
    }
  }

  if (field.pattern) {
    try {
      const regex = new RegExp(field.pattern);
      if (!regex.test(value)) {
        return `Field \"${field.label}\" does not match required format.`;
      }
    } catch {
      return null;
    }
  }

  if ((field.type === 'select' || field.type === 'radio') && (field.options || []).length > 0) {
    const allowed = new Set((field.options || []).map((option) => option.value));
    if (!allowed.has(value)) {
      return `Field \"${field.label}\" has invalid option value.`;
    }
  }

  if (field.type === 'json') {
    if (field.repeatable && field.repeatSeparator === 'json-lines') {
      try {
        parseJsonLines(value);
        return null;
      } catch {
        return `Field \"${field.label}\" must use valid JSON lines (one JSON object per line).`;
      }
    }

    try {
      JSON.parse(value);
    } catch {
      return `Field \"${field.label}\" must be valid JSON.`;
    }
  }

  return null;
}

function applyFieldToRequest(next: ApiRequest, field: RequestFormField, value: string): ApiRequest {
  const trimmedValue = value;

  if (field.target === 'param') {
    next.params = upsertKeyValuePair(next.params, field.targetKey, trimmedValue);
    return next;
  }

  if (field.target === 'header') {
    next.headers = upsertKeyValuePair(next.headers, field.targetKey, trimmedValue);
    return next;
  }

  if (field.target === 'body-form') {
    const formRows = next.body.formData || [];
    const formValue = field.repeatable
      ? JSON.stringify(parseRepeatableValue(trimmedValue, field.repeatSeparator || 'newline'))
      : trimmedValue;
    next.body = {
      ...next.body,
      type: next.body.type === 'none' ? 'form-urlencoded' : next.body.type,
      formData: upsertKeyValuePair(formRows, field.targetKey, formValue),
    };
    return next;
  }

  if (field.target === 'body-json') {
    let baseObject: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(next.body.content || '{}') as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        baseObject = parsed as Record<string, unknown>;
      }
    } catch {
      baseObject = {};
    }

    const normalized = normalizeFieldValue(trimmedValue, field);
    if (field.repeatable && typeof normalized === 'string') {
      try {
        setObjectPath(baseObject, field.targetKey, JSON.parse(normalized));
      } catch {
        setObjectPath(baseObject, field.targetKey, parseRepeatableValue(trimmedValue, field.repeatSeparator || 'newline'));
      }
      next.body = {
        ...next.body,
        type: 'json',
        content: JSON.stringify(baseObject, null, 2),
      };
      return next;
    }

    if (field.type === 'json' && typeof normalized === 'string') {
      try {
        setObjectPath(baseObject, field.targetKey, JSON.parse(normalized));
      } catch {
        setObjectPath(baseObject, field.targetKey, normalized);
      }
      next.body = {
        ...next.body,
        type: 'json',
        content: JSON.stringify(baseObject, null, 2),
      };
      return next;
    }

    if (field.type === 'address' && typeof normalized === 'string') {
      try {
        setObjectPath(baseObject, field.targetKey, JSON.parse(normalized));
      } catch {
        setObjectPath(baseObject, field.targetKey, normalized);
      }
    } else {
      setObjectPath(baseObject, field.targetKey, normalized);
    }
    next.body = {
      ...next.body,
      type: 'json',
      content: JSON.stringify(baseObject, null, 2),
    };
    return next;
  }

  if (field.target === 'auth-token') {
    next.auth = {
      ...next.auth,
      type: next.auth.type === 'none' ? 'bearer' : next.auth.type,
      token: trimmedValue,
    };
    return next;
  }

  if (field.target === 'auth-username') {
    next.auth = {
      ...next.auth,
      type: 'basic',
      username: trimmedValue,
    };
    return next;
  }

  if (field.target === 'auth-password') {
    next.auth = {
      ...next.auth,
      type: 'basic',
      password: trimmedValue,
    };
    return next;
  }

  if (field.target === 'auth-api-key-value') {
    next.auth = {
      ...next.auth,
      type: 'api-key',
      key: next.auth.key || field.targetKey || 'X-API-Key',
      value: trimmedValue,
      addTo: next.auth.addTo || 'header',
    };
    return next;
  }

  return next;
}

function applyAuthRequirement(
  next: ApiRequest,
  config: RequestFormConfig | undefined,
  responses: Record<string, ProxyResponse>,
): { request: ApiRequest; error?: string } {
  const requirement = config?.authRequirement;
  if (!requirement?.enabled) {
    return { request: next };
  }

  if (!requirement.sourceRequestId) {
    return { request: next, error: 'Auth dependency requires a source request.' };
  }

  const sourceResponse = responses[requirement.sourceRequestId];
  if (!sourceResponse) {
    return { request: next, error: 'Send auth source request first to unlock this endpoint.' };
  }

  const token = extractResponseValue(sourceResponse, requirement.tokenPath || defaultTokenPath(sourceResponse.body));
  if (!token) {
    return { request: next, error: 'Auth token not found in source response. Check token path mapping.' };
  }

  const headerName = requirement.headerName || 'Authorization';
  const scheme = requirement.scheme || 'Bearer';
  const authValue = scheme === 'Raw' ? token : `${scheme} ${token}`;
  next.headers = upsertKeyValuePair(next.headers, headerName, authValue);
  return { request: next };
}

export function applyFormToRequest(
  request: ApiRequest,
  values: Record<string, string>,
  responses: Record<string, ProxyResponse>,
): { request: ApiRequest; error?: string } {
  const next = cloneRequest(request);
  const config = request.formConfig;

  if (!config?.enabled) {
    return { request: next };
  }

  for (const field of config.fields) {
    if (!isFieldVisible(field, values)) {
      continue;
    }

    const fieldValue = values[field.name] ?? field.defaultValue ?? '';
    const validationError = validateFieldValue(field, String(fieldValue));
    if (validationError) {
      return { request: next, error: validationError };
    }
    applyFieldToRequest(next, field, fieldValue);
  }

  return applyAuthRequirement(next, config, responses);
}

export function getInitialFormValues(request: ApiRequest): Record<string, string> {
  const values: Record<string, string> = {};
  request.formConfig?.fields.forEach((field) => {
    values[field.name] = field.defaultValue || '';
  });
  return values;
}

export function runFormScript<T>(script: string | undefined, context: Record<string, unknown>, fallback: T): T {
  if (!script || !script.trim()) {
    return fallback;
  }

  try {
    const fn = new Function('context', `"use strict"; ${script}`) as (ctx: Record<string, unknown>) => unknown;
    const result = fn(context);
    if (result === undefined) {
      return fallback;
    }
    return result as T;
  } catch {
    return fallback;
  }
}
