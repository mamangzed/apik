import axios from 'axios';
import { apiClient } from './apiClient';
import { ProxyResponse } from '../types';

type RequestTransportPayload = {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string | null;
  timeout?: number;
};

type ExtensionProxyResponsePayload = {
  requestId: string;
  ok: boolean;
  response?: ProxyResponse;
  error?: string;
};

function isLocalhostHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === 'localhost' ||
    normalized === '127.0.0.1' ||
    normalized === '::1' ||
    normalized.endsWith('.localhost')
  );
}

export function shouldBypassProxy(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return false;
    }

    // Localhost traffic should stay in the browser (remote proxy cannot reach user machine).
    // But from a hosted HTTPS app, browsers may block localhost requests due to CORS/PNA.
    return isLocalhostHost(parsed.hostname);
  } catch {
    return false;
  }
}

function getHeaderValue(headers: Record<string, string>, name: string): string {
  const target = name.toLowerCase();
  const foundKey = Object.keys(headers).find((key) => key.toLowerCase() === target);
  return foundKey ? headers[foundKey] : '';
}

function isTextContent(contentType: string): boolean {
  const value = contentType.toLowerCase();
  return (
    value.includes('text') ||
    value.includes('json') ||
    value.includes('xml') ||
    value.includes('javascript') ||
    value.includes('html')
  );
}

function toBase64(buffer: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < buffer.length; index += 1) {
    binary += String.fromCharCode(buffer[index]);
  }
  return btoa(binary);
}

async function sendDirect(payload: RequestTransportPayload): Promise<ProxyResponse> {
  const startedAt = Date.now();
  let response;
  try {
    response = await axios.request<ArrayBuffer>({
      method: payload.method,
      url: payload.url,
      headers: payload.headers,
      data: payload.body,
      timeout: payload.timeout || 30000,
      validateStatus: () => true,
      responseType: 'arraybuffer',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Network Error';
    if (shouldBypassProxy(payload.url)) {
      throw new Error(
        `Localhost request failed in browser. Ensure local API allows CORS from this origin and, for HTTPS app, allow private network access. Original error: ${message}`,
      );
    }
    throw error;
  }

  const responseHeaders: Record<string, string> = {};
  Object.entries(response.headers || {}).forEach(([key, value]) => {
    if (value !== undefined) {
      responseHeaders[key] = Array.isArray(value) ? value.join(', ') : String(value);
    }
  });

  const contentType = getHeaderValue(responseHeaders, 'content-type');
  const buffer = new Uint8Array(response.data || new ArrayBuffer(0));

  const body = isTextContent(contentType)
    ? new TextDecoder('utf-8').decode(buffer)
    : toBase64(buffer);

  return {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
    body,
    size: buffer.byteLength,
    time: Date.now() - startedAt,
  };
}

async function sendViaExtension(payload: RequestTransportPayload): Promise<ProxyResponse> {
  if (typeof window === 'undefined') {
    throw new Error('Extension bridge is unavailable in this context');
  }

  const requestId = `proxy_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  return new Promise<ProxyResponse>((resolve, reject) => {
    const timeoutMs = (payload.timeout || 30000) + 3000;

    const cleanup = (timer: number) => {
      window.removeEventListener('message', handleMessage);
      window.clearTimeout(timer);
    };

    const handleMessage = (event: MessageEvent) => {
      if (event.source !== window) return;
      const data = event.data as {
        source?: string;
        type?: string;
        payload?: ExtensionProxyResponsePayload;
      };

      if (data?.source !== 'apik-extension') return;
      if (data?.type !== 'APIK_EXTENSION_PROXY_RESPONSE') return;
      if (!data.payload || data.payload.requestId !== requestId) return;

      cleanup(timer);

      if (data.payload.ok && data.payload.response) {
        resolve(data.payload.response);
        return;
      }

      reject(new Error(data.payload.error || 'Extension proxy request failed'));
    };

    const timer = window.setTimeout(() => {
      cleanup(timer);
      reject(new Error('Extension proxy timeout. Ensure APIK extension is installed and active on this page.'));
    }, timeoutMs);

    window.addEventListener('message', handleMessage);

    window.postMessage(
      {
        source: 'apik-web',
        type: 'APIK_EXTENSION_PROXY_REQUEST',
        payload: {
          requestId,
          request: payload,
        },
      },
      window.location.origin,
    );
  });
}

export async function sendRequestWithSmartTransport(payload: RequestTransportPayload): Promise<ProxyResponse> {
  if (shouldBypassProxy(payload.url)) {
    try {
      return await sendViaExtension(payload);
    } catch (extensionError) {
      try {
        return await sendDirect(payload);
      } catch (directError) {
        const extMessage = extensionError instanceof Error ? extensionError.message : 'Extension transport failed';
        const directMessage = directError instanceof Error ? directError.message : 'Browser transport failed';
        throw new Error(`Localhost request failed. Extension path: ${extMessage}. Browser path: ${directMessage}`);
      }
    }
  }

  const { data } = await apiClient.post<ProxyResponse>('/proxy', {
    method: payload.method,
    url: payload.url,
    headers: payload.headers,
    body: payload.body,
    timeout: payload.timeout || 30000,
  });

  return data;
}
