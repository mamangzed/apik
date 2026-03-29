import { CollectionRunAssertion, ProxyResponse } from '../types';

export type ScriptStage = 'pre-request' | 'post-request';

export interface ScriptRuntimeRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | null;
}

export interface ScriptRuntimeInput {
  stage: ScriptStage;
  script?: string;
  request: ScriptRuntimeRequest;
  response?: ProxyResponse;
  environmentValues: Record<string, string>;
  collectAssertions?: boolean;
}

export interface ScriptRuntimeResult {
  request: ScriptRuntimeRequest;
  environmentValues: Record<string, string>;
  assertions: CollectionRunAssertion[];
  logs: string[];
  error?: string;
}

type ExpectApi = {
  toBe: (expected: unknown) => void;
  toEqual: (expected: unknown) => void;
  toContain: (expected: string) => void;
  toMatch: (expected: RegExp | string) => void;
  toBeTruthy: () => void;
  toBeFalsy: () => void;
  toBeDefined: () => void;
  toBeUndefined: () => void;
  toBeNull: () => void;
  toBeGreaterThan: (expected: number) => void;
  toBeGreaterThanOrEqual: (expected: number) => void;
  toBeLessThan: (expected: number) => void;
  toBeLessThanOrEqual: (expected: number) => void;
};

function stringify(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return a === b;
  }
}

function getHeaderValue(headers: Record<string, string>, name: string): string | undefined {
  const target = name.toLowerCase();
  const hit = Object.keys(headers).find((key) => key.toLowerCase() === target);
  return hit ? headers[hit] : undefined;
}

function mutateQueryString(urlText: string, callback: (params: URLSearchParams) => void): string {
  try {
    const absolute = new URL(urlText);
    callback(absolute.searchParams);
    return absolute.toString();
  } catch {
    const hashIndex = urlText.indexOf('#');
    const beforeHash = hashIndex >= 0 ? urlText.slice(0, hashIndex) : urlText;
    const hashPart = hashIndex >= 0 ? urlText.slice(hashIndex) : '';
    const queryIndex = beforeHash.indexOf('?');
    const base = queryIndex >= 0 ? beforeHash.slice(0, queryIndex) : beforeHash;
    const query = queryIndex >= 0 ? beforeHash.slice(queryIndex + 1) : '';
    const params = new URLSearchParams(query);
    callback(params);
    const nextQuery = params.toString();
    return `${base}${nextQuery ? `?${nextQuery}` : ''}${hashPart}`;
  }
}

function createExpect(actual: unknown): ExpectApi {
  return {
    toBe(expected) {
      if (actual !== expected) {
        throw new Error(`Expected ${stringify(actual)} to be ${stringify(expected)}`);
      }
    },
    toEqual(expected) {
      if (!deepEqual(actual, expected)) {
        throw new Error(`Expected ${stringify(actual)} to equal ${stringify(expected)}`);
      }
    },
    toContain(expected) {
      const text = String(actual ?? '');
      if (!text.includes(expected)) {
        throw new Error(`Expected value to contain ${expected}`);
      }
    },
    toMatch(expected) {
      const text = String(actual ?? '');
      const matcher = expected instanceof RegExp ? expected : new RegExp(expected);
      if (!matcher.test(text)) {
        throw new Error(`Expected value to match ${matcher}`);
      }
    },
    toBeTruthy() {
      if (!actual) {
        throw new Error(`Expected ${stringify(actual)} to be truthy`);
      }
    },
    toBeFalsy() {
      if (actual) {
        throw new Error(`Expected ${stringify(actual)} to be falsy`);
      }
    },
    toBeDefined() {
      if (typeof actual === 'undefined') {
        throw new Error('Expected value to be defined');
      }
    },
    toBeUndefined() {
      if (typeof actual !== 'undefined') {
        throw new Error('Expected value to be undefined');
      }
    },
    toBeNull() {
      if (actual !== null) {
        throw new Error('Expected value to be null');
      }
    },
    toBeGreaterThan(expected) {
      if (Number(actual) <= expected) {
        throw new Error(`Expected ${stringify(actual)} to be greater than ${expected}`);
      }
    },
    toBeGreaterThanOrEqual(expected) {
      if (Number(actual) < expected) {
        throw new Error(`Expected ${stringify(actual)} to be greater than or equal to ${expected}`);
      }
    },
    toBeLessThan(expected) {
      if (Number(actual) >= expected) {
        throw new Error(`Expected ${stringify(actual)} to be less than ${expected}`);
      }
    },
    toBeLessThanOrEqual(expected) {
      if (Number(actual) > expected) {
        throw new Error(`Expected ${stringify(actual)} to be less than or equal to ${expected}`);
      }
    },
  };
}

export async function executeApikScript(input: ScriptRuntimeInput): Promise<ScriptRuntimeResult> {
  const script = (input.script || '').trim();
  const requestState: ScriptRuntimeRequest = {
    method: input.request.method,
    url: input.request.url,
    headers: { ...input.request.headers },
    body: input.request.body,
  };
  const environmentValues = { ...input.environmentValues };
  const assertions: CollectionRunAssertion[] = [];
  const logs: string[] = [];
  const shouldCollectAssertions = input.collectAssertions ?? input.stage === 'post-request';

  if (!script) {
    return {
      request: requestState,
      environmentValues,
      assertions,
      logs,
    };
  }

  const addAssertion = (name: string, passed: boolean, error?: string) => {
    if (!shouldCollectAssertions) {
      return;
    }
    assertions.push({ name, passed, error });
  };

  const test = (name: string, callback: () => void) => {
    try {
      callback();
      addAssertion(name, true);
    } catch (error) {
      addAssertion(name, false, error instanceof Error ? error.message : 'Assertion failed');
    }
  };

  const requestApi = {
    get method() {
      return requestState.method;
    },
    set method(value: string) {
      requestState.method = String(value || 'GET').toUpperCase();
    },
    get url() {
      return requestState.url;
    },
    set url(value: string) {
      requestState.url = String(value || '');
    },
    get body() {
      return requestState.body;
    },
    set body(value: string | null) {
      requestState.body = value == null ? null : String(value);
    },
    headers: requestState.headers,
    setHeader(name: string, value: string) {
      requestState.headers[String(name)] = String(value);
    },
    removeHeader(name: string) {
      const target = String(name).toLowerCase();
      Object.keys(requestState.headers).forEach((key) => {
        if (key.toLowerCase() === target) {
          delete requestState.headers[key];
        }
      });
    },
    getHeader(name: string) {
      return getHeaderValue(requestState.headers, String(name)) || '';
    },
    setBody(value: string | null) {
      requestState.body = value == null ? null : String(value);
    },
    appendQueryParam(key: string, value: string) {
      requestState.url = mutateQueryString(requestState.url, (params) => {
        params.append(String(key), String(value));
      });
    },
    setQueryParam(key: string, value: string) {
      requestState.url = mutateQueryString(requestState.url, (params) => {
        params.set(String(key), String(value));
      });
    },
    removeQueryParam(key: string) {
      requestState.url = mutateQueryString(requestState.url, (params) => {
        params.delete(String(key));
      });
    },
    toJSON() {
      return {
        method: requestState.method,
        url: requestState.url,
        headers: { ...requestState.headers },
        body: requestState.body,
      };
    },
  };

  const envApi = {
    get(key: string) {
      return environmentValues[String(key)] || '';
    },
    set(key: string, value: string) {
      environmentValues[String(key)] = String(value);
    },
    unset(key: string) {
      delete environmentValues[String(key)];
    },
    has(key: string) {
      return Object.prototype.hasOwnProperty.call(environmentValues, String(key));
    },
    all() {
      return { ...environmentValues };
    },
    toObject() {
      return { ...environmentValues };
    },
    replaceIn(text: string) {
      return String(text).replace(/\{\{([^}]+)\}\}/g, (match, name) => {
        const key = String(name).trim();
        if (!Object.prototype.hasOwnProperty.call(environmentValues, key)) {
          return match;
        }
        return environmentValues[key] || '';
      });
    },
  };

  const responseApi = input.response
    ? {
        status: input.response.status,
        statusText: input.response.statusText,
        headers: { ...input.response.headers },
        body: input.response.body,
        size: input.response.size,
        time: input.response.time,
        text() {
          return input.response?.body || '';
        },
        json() {
          const raw = input.response?.body || '';
          if (!raw.trim()) {
            return null;
          }
          return JSON.parse(raw);
        },
        header(name: string) {
          return getHeaderValue(input.response?.headers || {}, String(name)) || '';
        },
      }
    : null;

  const apik = {
    stage: input.stage,
    env: envApi,
    variables: envApi,
    request: requestApi,
    response: responseApi,
    expect(actual: unknown) {
      return createExpect(actual);
    },
    assert(condition: unknown, message?: string) {
      if (!condition) {
        throw new Error(message || 'Assertion failed');
      }
    },
    test,
    log(...args: unknown[]) {
      logs.push(args.map((item) => stringify(item)).join(' '));
    },
    json() {
      if (!responseApi) {
        return null;
      }
      return responseApi.json();
    },
  };

  const scriptConsole = {
    log: (...args: unknown[]) => {
      logs.push(args.map((item) => stringify(item)).join(' '));
    },
    info: (...args: unknown[]) => {
      logs.push(args.map((item) => stringify(item)).join(' '));
    },
    warn: (...args: unknown[]) => {
      logs.push(`[warn] ${args.map((item) => stringify(item)).join(' ')}`);
    },
    error: (...args: unknown[]) => {
      logs.push(`[error] ${args.map((item) => stringify(item)).join(' ')}`);
    },
  };

  try {
    const runner = new Function(
      'apik',
      'apix',
      'pm',
      'console',
      `"use strict"; return (async () => {\n${script}\n})();`,
    ) as (
      apikApi: typeof apik,
      apixApi: typeof apik,
      pmApi: typeof apik,
      consoleApi: typeof scriptConsole,
    ) => Promise<unknown>;

    await runner(apik, apik, apik, scriptConsole);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Script execution failed';
    addAssertion('Script execution', false, message);
    return {
      request: requestState,
      environmentValues,
      assertions,
      logs,
      error: message,
    };
  }

  return {
    request: requestState,
    environmentValues,
    assertions,
    logs,
  };
}
