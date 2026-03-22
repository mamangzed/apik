function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function withInterceptScope(url: string, ticket?: string | null): string {
  try {
    const parsed = new URL(url);
    parsed.searchParams.set('type', 'app');

    const scopeId = localStorage.getItem('apik.ws.scopeId');
    if (scopeId) {
      parsed.searchParams.set('scopeId', scopeId);
    }

    if (ticket) {
      parsed.searchParams.set('ticket', ticket);
    }

    return parsed.toString();
  } catch {
    return url;
  }
}

export function getApiBaseUrl(): string {
  const configured = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim();
  if (!configured) {
    return '/api';
  }

  const normalized = trimTrailingSlash(configured);
  return normalized.endsWith('/api') ? normalized : `${normalized}/api`;
}

export function getAppBaseUrl(): string {
  const configured = (import.meta.env.VITE_APP_BASE_URL as string | undefined)?.trim();
  if (configured) {
    return trimTrailingSlash(configured);
  }
  return trimTrailingSlash(window.location.origin);
}

export function getWsInterceptUrl(ticket?: string | null): string {
  const configured = (import.meta.env.VITE_WS_BASE_URL as string | undefined)?.trim();
  if (configured) {
    const normalized = trimTrailingSlash(configured);
    const wsUrl = normalized.endsWith('/ws/intercept') ? normalized : `${normalized}/ws/intercept`;
    return withInterceptScope(wsUrl, ticket);
  }

  const apiBase = getApiBaseUrl();
  if (apiBase.startsWith('http://') || apiBase.startsWith('https://')) {
    const wsBase = apiBase.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
    const wsUrl = wsBase.endsWith('/api')
      ? `${wsBase.slice(0, -4)}/ws/intercept`
      : `${trimTrailingSlash(wsBase)}/ws/intercept`;
    return withInterceptScope(wsUrl, ticket);
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return withInterceptScope(`${protocol}//${window.location.host}/ws/intercept`, ticket);
}
