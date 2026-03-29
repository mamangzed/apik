import { create } from 'zustand';
import axios from 'axios';
import { immer } from 'zustand/middleware/immer';
import { enableMapSet } from 'immer';
import { v4 as uuidv4 } from 'uuid';
import {
  Collection,
  CollectionMember,
  CollectionMemberRole,
  Environment,
  ApiRequest,
  AppTab,
  ProxyResponse,
  RequestHistoryEntry,
  CollectionRunReport,
  CollectionRunItemResult,
  CollectionRunAssertion,
  AuditLogEntry,
  InterceptedRequest,
  StorageMode,
  VisibilityMode,
} from '../types';
import { apiClient } from '../lib/apiClient';
import { sendRequestWithSmartTransport } from '../lib/requestTransport';
import { getWsInterceptUrl } from '../lib/runtimeConfig';
import { executeApikScript, ScriptRuntimeRequest } from '../lib/scriptRuntime';
import { ImportSourceFormat } from '../lib/collectionTransfer';
import {
  clearLocalData,
  getLocalCollections,
  getLocalEnvironments,
  saveLocalCollections,
  saveLocalEnvironments,
} from '../lib/localStore';

enableMapSet();

function defaultSharing() {
  return {
    collection: { access: 'private' as const, token: null },
    docs: { access: 'private' as const, token: null },
    form: { access: 'private' as const, token: null },
  };
}

function createDefaultRequest(): ApiRequest {
  return {
    id: uuidv4(),
    name: 'New Request',
    method: 'GET',
    url: '',
    params: [],
    headers: [{ id: uuidv4(), key: 'Accept', value: 'application/json', enabled: true }],
    body: { type: 'none', content: '' },
    auth: { type: 'none' },
    preRequestScript: '',
    testScript: '',
    retryPolicy: {
      retries: 0,
      retryDelayMs: 500,
      retryOnStatuses: [408, 429, 500, 502, 503, 504],
      circuitBreakerThreshold: 3,
      circuitBreakerCooldownMs: 30000,
    },
    mockExamples: [],
    description: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function normalizeCollection(collection: Collection, storageScope: StorageMode): Collection {
  return {
    ...collection,
    description: collection.description || '',
    requests: collection.requests || [],
    folders: collection.folders || [],
    variables: collection.variables || [],
    sharing: collection.sharing || defaultSharing(),
    collaborators: collection.collaborators || [],
    runReports: collection.runReports || [],
    auditLog: collection.auditLog || [],
    currentUserRole: collection.currentUserRole,
    storageScope,
  };
}

function normalizeEnvironment(environment: Environment, storageScope: StorageMode): Environment {
  return {
    ...environment,
    variables: (environment.variables || []).map((variable) => ({
      ...variable,
      value: decodeSecretValue(variable.value),
      initialValue: decodeSecretValue(variable.initialValue || ''),
    })),
    storageScope,
  };
}

const SECRET_PREFIX = 'apik-secret:';

function encodeSecretValue(value: string): string {
  if (!value) {
    return '';
  }
  if (value.startsWith(SECRET_PREFIX)) {
    return value;
  }
  try {
    return `${SECRET_PREFIX}${btoa(unescape(encodeURIComponent(value)))}`;
  } catch {
    return value;
  }
}

function decodeSecretValue(value: string): string {
  if (!value || !value.startsWith(SECRET_PREFIX)) {
    return value;
  }
  try {
    const raw = value.slice(SECRET_PREFIX.length);
    return decodeURIComponent(escape(atob(raw)));
  } catch {
    return value;
  }
}

function prepareEnvironmentForPersistence(environment: Environment): Environment {
  return {
    ...environment,
    variables: (environment.variables || []).map((variable) => {
      if (!variable.secret) {
        return {
          ...variable,
          value: decodeSecretValue(variable.value),
          initialValue: decodeSecretValue(variable.initialValue || ''),
        };
      }

      return {
        ...variable,
        value: encodeSecretValue(variable.value),
        initialValue: encodeSecretValue(variable.initialValue || ''),
      };
    }),
  };
}

interface AppState {
  collections: Collection[];
  environments: Environment[];
  activeEnvironmentId: string | null;
  tabs: AppTab[];
  activeTabId: string | null;
  responses: Record<string, ProxyResponse>;
  postRequestAssertions: Record<string, CollectionRunAssertion[]>;
  loadingTabs: Set<string>;
  interceptEnabled: boolean;
  interceptedRequests: InterceptedRequest[];
  wsConnected: boolean;
  sidebarWidth: number;
  interceptTabOpen: boolean;
  showInterceptPanel: boolean;
  showEnvModal: boolean;
  showDocViewer: boolean;
  docViewerCollection: string | null;
  showImportModal: boolean;
  searchQuery: string;
  interceptSearchQuery: string;
  storageMode: StorageMode;
  authReady: boolean;
  isAuthenticated: boolean;
  userId: string | null;
  showShareModal: boolean;
  shareModalCollectionId: string | null;
  shareModalTarget: 'collection' | 'docs' | 'form';
  requestHistory: RequestHistoryEntry[];
  pendingCloseTabId: string | null;

  setAuthState: (payload: { authReady: boolean; isAuthenticated: boolean; userId: string | null }) => void;
  syncLocalDataToRemote: () => Promise<void>;

  loadCollections: () => Promise<void>;
  createCollection: (name: string, description?: string) => Promise<void>;
  deleteCollection: (id: string) => Promise<void>;
  renameCollection: (id: string, name: string) => Promise<void>;
  addRequestToCollection: (collectionId: string, request?: Partial<ApiRequest>) => Promise<void>;
  reorderRequestInCollection: (collectionId: string, sourceRequestId: string, targetRequestId: string) => Promise<void>;
  updateRequestInCollection: (collectionId: string, request: ApiRequest) => Promise<'remote' | 'local'>;
  deleteRequestFromCollection: (collectionId: string, requestId: string) => Promise<void>;
  importCollection: (data: unknown, format: ImportSourceFormat | 'apix') => Promise<void>;
  updateCollectionShareAccess: (collectionId: string, target: 'collection' | 'docs' | 'form', access: VisibilityMode) => Promise<Collection>;
  loadCollectionMembers: (collectionId: string) => Promise<CollectionMember[]>;
  upsertCollectionMember: (collectionId: string, userId: string, role: CollectionMemberRole) => Promise<CollectionMember[]>;
  removeCollectionMember: (collectionId: string, userId: string) => Promise<CollectionMember[]>;
  openShareModal: (collectionId: string, target: 'collection' | 'docs' | 'form') => void;
  setShowShareModal: (show: boolean) => void;

  loadEnvironments: () => Promise<void>;
  createEnvironment: (name: string) => Promise<void>;
  updateEnvironment: (env: Environment) => Promise<void>;
  deleteEnvironment: (id: string) => Promise<void>;
  activateEnvironment: (id: string | null) => Promise<void>;
  getActiveEnvironment: () => Environment | null;
  resolveVariables: (text: string) => string;

  openTab: (request: ApiRequest, collectionId?: string) => void;
  closeTab: (tabId: string, options?: { skipConfirm?: boolean }) => void;
  confirmCloseTab: () => void;
  cancelCloseTab: () => void;
  setActiveTab: (tabId: string) => void;
  reorderTabs: (sourceTabId: string, targetTabId: string) => void;
  updateActiveRequest: (updates: Partial<ApiRequest>) => void;
  openNewTab: () => void;
  replayHistoryEntry: (historyId: string) => Promise<void>;
  clearRequestHistory: () => void;
  runCollection: (collectionId: string) => Promise<CollectionRunReport>;
  getRequestDiff: (tabId: string) => string[];
  saveResponseAsMockExample: (tabId: string) => Promise<void>;
  loadMockExampleForTab: (tabId: string, index: number) => void;
  deleteMockExampleFromRequest: (tabId: string, index: number) => Promise<void>;
  deleteMockExampleFromDocs: (collectionId: string, requestId: string, index: number) => Promise<void>;

  sendRequest: (tabId: string) => Promise<void>;

  setInterceptEnabled: (enabled: boolean) => void;
  forwardInterceptedRequest: (id: string, modified?: Record<string, unknown>) => void;
  dropInterceptedRequest: (id: string) => void;
  clearInterceptedRequests: () => void;
  initWebSocket: () => Promise<void>;

  setShowEnvModal: (show: boolean) => void;
  setShowInterceptPanel: (show: boolean) => void;
  closeInterceptTab: () => void;
  setShowDocViewer: (show: boolean, collectionId?: string) => void;
  setShowImportModal: (show: boolean) => void;
  setSearchQuery: (q: string) => void;
  setInterceptSearchQuery: (q: string) => void;
}

let wsInstance: WebSocket | null = null;
let wsReconnectTimer: number | null = null;
let wsReconnectDelay = 1000; // Exponential backoff, starts at 1s, max 30s
let desiredInterceptEnabled = false;

function clearReconnectTimer(): void {
  if (wsReconnectTimer == null) {
    return;
  }

  window.clearTimeout(wsReconnectTimer);
  wsReconnectTimer = null;
}

function scheduleReconnect(callback: () => void): void {
  if (wsReconnectTimer != null) {
    return;
  }

  const delay = wsReconnectDelay;
  wsReconnectDelay = Math.min(wsReconnectDelay * 2, 30000);

  wsReconnectTimer = window.setTimeout(() => {
    wsReconnectTimer = null;
    callback();
  }, delay);
}

function teardownInterceptSocket(): void {
  clearReconnectTimer();

  if (!wsInstance) {
    return;
  }

  const activeSocket = wsInstance;
  wsInstance = null;

  activeSocket.onopen = null;
  activeSocket.onclose = null;
  activeSocket.onerror = null;
  activeSocket.onmessage = null;

  try {
    activeSocket.close();
  } catch {
    // Ignore close errors for stale sockets.
  }
}

const environmentUpdateVersion: Record<string, number> = {};
const DRAFT_TABS_STORAGE_KEY = 'apik.drafts.v1';
const REQUEST_HISTORY_STORAGE_KEY = 'apik.requestHistory.v1';
const MAX_HISTORY_ITEMS = 200;
const requestFailureState: Record<string, { failures: number; blockedUntil: number }> = {};

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function loadDraftState(): { tabs: AppTab[]; activeTabId: string | null } {
  try {
    const raw = localStorage.getItem(DRAFT_TABS_STORAGE_KEY);
    if (!raw) {
      return { tabs: [], activeTabId: null };
    }

    const parsed = JSON.parse(raw) as { tabs?: AppTab[]; activeTabId?: string | null };
    const tabs = Array.isArray(parsed.tabs) ? parsed.tabs : [];
    const activeTabId = typeof parsed.activeTabId === 'string' ? parsed.activeTabId : null;

    return {
      tabs,
      activeTabId: activeTabId && tabs.some((tab) => tab.id === activeTabId) ? activeTabId : (tabs[0]?.id ?? null),
    };
  } catch {
    return { tabs: [], activeTabId: null };
  }
}

function saveDraftState(tabs: AppTab[], activeTabId: string | null): void {
  try {
    localStorage.setItem(DRAFT_TABS_STORAGE_KEY, JSON.stringify({ tabs, activeTabId }));
  } catch {
    // Ignore storage failures.
  }
}

function loadRequestHistory(): RequestHistoryEntry[] {
  try {
    const raw = localStorage.getItem(REQUEST_HISTORY_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as RequestHistoryEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveRequestHistory(entries: RequestHistoryEntry[]): void {
  try {
    localStorage.setItem(REQUEST_HISTORY_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Ignore storage failures.
  }
}

function compareFieldDiff(label: string, before: unknown, after: unknown, diffs: string[]) {
  const beforeText = JSON.stringify(before ?? null);
  const afterText = JSON.stringify(after ?? null);
  if (beforeText !== afterText) {
    diffs.push(label);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetryStatus(status: number, retryStatuses: number[]): boolean {
  return retryStatuses.includes(status);
}

function buildEnvironmentValueMap(environment: Environment | null): Record<string, string> {
  if (!environment) {
    return {};
  }

  const map: Record<string, string> = {};
  environment.variables.forEach((variable) => {
    if (variable.enabled && variable.key) {
      map[variable.key] = variable.value;
    }
  });

  return map;
}

function resolveWithMap(text: string, values: Record<string, string>): string {
  return text.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
    const trimmed = String(key).trim();
    if (!Object.prototype.hasOwnProperty.call(values, trimmed)) {
      return match;
    }
    return values[trimmed] || '';
  });
}

function buildRequestPayload(
  request: ApiRequest,
  resolveVariables: (text: string) => string,
): ScriptRuntimeRequest {
  const searchParams = new URLSearchParams();
  request.params.filter((param) => param.enabled && param.key).forEach((param) => {
    searchParams.append(resolveVariables(param.key), resolveVariables(param.value));
  });

  let url = resolveVariables(request.url);
  const queryString = searchParams.toString();
  if (queryString) {
    url += (url.includes('?') ? '&' : '?') + queryString;
  }

  const headers: Record<string, string> = {};
  request.headers.filter((header) => header.enabled && header.key).forEach((header) => {
    headers[resolveVariables(header.key)] = resolveVariables(header.value);
  });

  if (request.auth.type === 'bearer' && request.auth.token) {
    headers.Authorization = `Bearer ${resolveVariables(request.auth.token)}`;
  } else if (request.auth.type === 'basic' && request.auth.username) {
    headers.Authorization = `Basic ${btoa(`${request.auth.username}:${request.auth.password || ''}`)}`;
  } else if (request.auth.type === 'api-key' && request.auth.key) {
    const key = resolveVariables(request.auth.key);
    const value = resolveVariables(request.auth.value || '');
    if (request.auth.addTo === 'query') {
      try {
        const urlObject = new URL(url);
        urlObject.searchParams.set(key, value);
        url = urlObject.toString();
      } catch {
        const params = new URLSearchParams(url.includes('?') ? url.split('?')[1] : '');
        params.set(key, value);
        const base = url.split('?')[0];
        const nextQuery = params.toString();
        url = nextQuery ? `${base}?${nextQuery}` : base;
      }
    } else {
      headers[key] = value;
    }
  }

  let body: string | null = null;
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    if (request.body.type === 'json') {
      body = resolveVariables(request.body.content);
      if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
    } else if (request.body.type === 'xml') {
      body = resolveVariables(request.body.content);
      if (!headers['Content-Type']) headers['Content-Type'] = 'application/xml';
    } else if (request.body.type === 'text') {
      body = resolveVariables(request.body.content);
      if (!headers['Content-Type']) headers['Content-Type'] = 'text/plain';
    } else if (request.body.type === 'form-urlencoded') {
      const formData = new URLSearchParams();
      (request.body.formData || []).filter((entry) => entry.enabled && entry.key).forEach((entry) => {
        formData.append(resolveVariables(entry.key), resolveVariables(entry.value));
      });
      body = formData.toString();
      if (!headers['Content-Type']) headers['Content-Type'] = 'application/x-www-form-urlencoded';
    } else if (request.body.type === 'graphql') {
      try {
        body = JSON.stringify(JSON.parse(resolveVariables(request.body.content || '{}')));
      } catch {
        body = resolveVariables(request.body.content);
      }
      if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
    }
  }

  return {
    method: request.method,
    url,
    headers,
    body,
  };
}

async function loadCollectionsByMode(storageMode: StorageMode): Promise<Collection[]> {
  if (storageMode === 'remote') {
    const { data } = await apiClient.get<Collection[]>('/collections');
    return data.map((collection) => normalizeCollection(collection, 'remote'));
  }

  return getLocalCollections().map((collection) => normalizeCollection(collection, 'local'));
}

async function loadEnvironmentsByMode(storageMode: StorageMode): Promise<Environment[]> {
  if (storageMode === 'remote') {
    const { data } = await apiClient.get<Environment[]>('/environments');
    return data.map((environment) => normalizeEnvironment(environment, 'remote'));
  }

  return getLocalEnvironments().map((environment) => normalizeEnvironment(environment, 'local'));
}

function ensureMutationsAllowed(authReady: boolean) {
  if (!authReady) {
    throw new Error('Authentication is still loading. Please wait a moment and try again.');
  }
}

function ensureCollectionEditable(state: Pick<AppState, 'storageMode' | 'collections'>, collectionId: string) {
  if (state.storageMode !== 'remote') {
    return;
  }

  const collection = state.collections.find((entry) => entry.id === collectionId);
  if (!collection) {
    return;
  }

  if (collection.currentUserRole === 'viewer') {
    throw new Error('You do not have edit access to this collection');
  }
}

function saveCollectionsLocal(collections: Collection[]): Collection[] {
  const normalized = collections.map((collection) => normalizeCollection(collection, 'local'));
  saveLocalCollections(normalized);
  return normalized;
}

function saveEnvironmentsLocal(environments: Environment[]): Environment[] {
  const normalized = environments.map((environment) => normalizeEnvironment(environment, 'local'));
  saveLocalEnvironments(normalized);
  return normalized;
}

const initialLocalEnvironments = getLocalEnvironments().map((environment) => normalizeEnvironment(environment, 'local'));
const initialDraftState = loadDraftState();
const initialRequestHistory = loadRequestHistory();

export const useAppStore = create<AppState>()(
  immer((set, get) => ({
    collections: getLocalCollections().map((collection) => normalizeCollection(collection, 'local')),
    environments: initialLocalEnvironments,
    activeEnvironmentId: initialLocalEnvironments.find((environment) => environment.isActive)?.id ?? null,
    tabs: initialDraftState.tabs,
    activeTabId: initialDraftState.activeTabId,
    responses: {},
    postRequestAssertions: {},
    loadingTabs: new Set(),
    interceptEnabled: false,
    interceptedRequests: [],
    wsConnected: false,
    sidebarWidth: 260,
    interceptTabOpen: false,
    showInterceptPanel: false,
    showEnvModal: false,
    showDocViewer: false,
    docViewerCollection: null,
    showImportModal: false,
    searchQuery: '',
    interceptSearchQuery: '',
    storageMode: 'local',
    authReady: false,
    isAuthenticated: false,
    userId: null,
    showShareModal: false,
    shareModalCollectionId: null,
    shareModalTarget: 'collection',
    requestHistory: initialRequestHistory,
    pendingCloseTabId: null,

    setAuthState: ({ authReady, isAuthenticated, userId }) => {
      set((state) => {
        state.authReady = authReady;
        state.isAuthenticated = isAuthenticated;
        state.userId = userId;
        // Keep current mode while auth is still resolving to avoid accidental local writes.
        if (authReady) {
          const nextMode: StorageMode = isAuthenticated ? 'remote' : 'local';
          const modeChanged = state.storageMode !== nextMode;
          state.storageMode = nextMode;

          if (modeChanged && nextMode === 'remote') {
            // Prevent stale local data from appearing while remote data is loading.
            state.collections = [];
            state.environments = [];
            state.activeEnvironmentId = null;
            state.tabs = [];
            state.activeTabId = null;
          }
        }
      });

      if (!authReady || !isAuthenticated || !userId) {
        teardownInterceptSocket();
        set((state) => {
          state.wsConnected = false;
          state.interceptEnabled = false;
          state.interceptedRequests = [];
        });
      } else {
        void get().initWebSocket();
      }

      const snapshot = get();
      saveDraftState(snapshot.tabs, snapshot.activeTabId);
    },

    syncLocalDataToRemote: async () => {
      if (!get().isAuthenticated) {
        return;
      }

      const localCollections = getLocalCollections();
      const localEnvironments = getLocalEnvironments();
      if (localCollections.length === 0 && localEnvironments.length === 0) {
        // Remove stale keys when account mode is active.
        clearLocalData();
        return;
      }

      await apiClient.post('/sync/local', {
        collections: localCollections,
        environments: localEnvironments,
      });

      // Local cache should not be used anymore once cloud sync succeeds.
      clearLocalData();
    },

    loadCollections: async () => {
      const collections = await loadCollectionsByMode(get().storageMode);
      set((state) => {
        state.collections = collections;
      });
    },

    createCollection: async (name, description) => {
      ensureMutationsAllowed(get().authReady);

      if (get().storageMode === 'remote') {
        const { data } = await apiClient.post<Collection>('/collections', { name, description });
        set((state) => {
          state.collections.unshift(normalizeCollection(data, 'remote'));
        });
        return;
      }

      const now = new Date().toISOString();
      const nextCollections = saveCollectionsLocal([
        {
          id: uuidv4(),
          name,
          description: description || '',
          requests: [],
          folders: [],
          variables: [],
          sharing: defaultSharing(),
          storageScope: 'local',
          createdAt: now,
          updatedAt: now,
        },
        ...get().collections,
      ] as Collection[]);

      set((state) => {
        state.collections = nextCollections;
      });
    },

    deleteCollection: async (id) => {
      ensureMutationsAllowed(get().authReady);
      ensureCollectionEditable(get(), id);

      if (get().storageMode === 'remote') {
        await apiClient.delete(`/collections/${id}`);
      } else {
        saveCollectionsLocal(get().collections.filter((collection) => collection.id !== id));
      }

      set((state) => {
        state.collections = state.collections.filter((collection) => collection.id !== id);
        state.tabs = state.tabs.filter((tab) => tab.requestState.collectionId !== id);
        if (state.activeTabId && !state.tabs.find((tab) => tab.id === state.activeTabId)) {
          state.activeTabId = state.tabs[0]?.id ?? null;
        }
      });

      const snapshot = get();
      saveDraftState(snapshot.tabs, snapshot.activeTabId);
    },

    renameCollection: async (id, name) => {
      ensureMutationsAllowed(get().authReady);
      ensureCollectionEditable(get(), id);

      if (get().storageMode === 'remote') {
        const { data } = await apiClient.put<Collection>(`/collections/${id}`, { name });
        set((state) => {
          const index = state.collections.findIndex((collection) => collection.id === id);
          if (index !== -1) {
            state.collections[index] = normalizeCollection(data, 'remote');
          }
        });
        return;
      }

      const nextCollections = saveCollectionsLocal(
        get().collections.map((collection) =>
          collection.id === id
            ? { ...collection, name, updatedAt: new Date().toISOString() }
            : collection,
        ),
      );
      set((state) => {
        state.collections = nextCollections;
      });
    },

    addRequestToCollection: async (collectionId, request) => {
      ensureMutationsAllowed(get().authReady);
      ensureCollectionEditable(get(), collectionId);

      if (get().storageMode === 'remote') {
        const { data } = await apiClient.post<ApiRequest>(`/collections/${collectionId}/requests`, request || {});
        set((state) => {
          const collection = state.collections.find((entry) => entry.id === collectionId);
          if (collection) {
            collection.requests.push(data);
            collection.updatedAt = new Date().toISOString();
          }
        });
        return;
      }

      const now = new Date().toISOString();
      const nextRequest = {
        ...createDefaultRequest(),
        ...request,
        id: uuidv4(),
        createdAt: now,
        updatedAt: now,
      };
      const nextCollections = saveCollectionsLocal(
        get().collections.map((collection) =>
          collection.id === collectionId
            ? { ...collection, requests: [...collection.requests, nextRequest], updatedAt: now }
            : collection,
        ),
      );
      set((state) => {
        state.collections = nextCollections;
      });
    },

    reorderRequestInCollection: async (collectionId, sourceRequestId, targetRequestId) => {
      ensureMutationsAllowed(get().authReady);
      ensureCollectionEditable(get(), collectionId);

      const collection = get().collections.find((entry) => entry.id === collectionId);
      if (!collection) {
        throw new Error('Collection not found');
      }

      const sourceIndex = collection.requests.findIndex((request) => request.id === sourceRequestId);
      const targetIndex = collection.requests.findIndex((request) => request.id === targetRequestId);

      if (sourceIndex === -1 || targetIndex === -1 || sourceIndex === targetIndex) {
        return;
      }

      const reordered = [...collection.requests];
      const [moved] = reordered.splice(sourceIndex, 1);
      const insertIndex = sourceIndex < targetIndex ? targetIndex - 1 : targetIndex;
      reordered.splice(insertIndex, 0, moved);

      if (get().storageMode === 'remote') {
        const { data } = await apiClient.put<Collection>(`/collections/${collectionId}`, {
          requests: reordered,
        });

        set((state) => {
          const collectionIndex = state.collections.findIndex((entry) => entry.id === collectionId);
          if (collectionIndex !== -1) {
            state.collections[collectionIndex] = normalizeCollection(data, 'remote');
          }
        });
        return;
      }

      const now = new Date().toISOString();
      const nextCollections = saveCollectionsLocal(
        get().collections.map((entry) =>
          entry.id === collectionId
            ? {
                ...entry,
                requests: reordered,
                updatedAt: now,
              }
            : entry,
        ),
      );

      set((state) => {
        state.collections = nextCollections;
      });
    },

    updateRequestInCollection: async (collectionId, request) => {
      ensureMutationsAllowed(get().authReady);
      ensureCollectionEditable(get(), collectionId);

      if (get().storageMode === 'remote') {
        let data: ApiRequest;

        const putRequest = async (payload: ApiRequest, expectedUpdatedAt: string | undefined) =>
          apiClient.put<ApiRequest>(`/collections/${collectionId}/requests/${payload.id}`, {
            ...payload,
            expectedUpdatedAt,
          });

        try {
          const updateResponse = await putRequest(request, request.updatedAt);
          data = updateResponse.data;
        } catch (error) {
          const isConflict = axios.isAxiosError(error) && error.response?.status === 409;
          const isNotFound = axios.isAxiosError(error) && error.response?.status === 404;
          if (isConflict) {
            // Recover automatically by rebasing this edit on top of the latest request state.
            const { data: latestCollections } = await apiClient.get<Collection[]>('/collections');
            const latestCollection = latestCollections.find((entry) => entry.id === collectionId);
            const latestRequest = latestCollection?.requests.find((entry) => entry.id === request.id);
            if (!latestRequest) {
              throw new Error('Request changed by another collaborator. Reload collection and retry.');
            }

            const rebasedPayload: ApiRequest = {
              ...latestRequest,
              ...request,
              id: latestRequest.id,
              createdAt: latestRequest.createdAt,
              updatedAt: latestRequest.updatedAt,
            };

            const retryResponse = await putRequest(rebasedPayload, latestRequest.updatedAt);
            data = retryResponse.data;
          } else {
            if (!isNotFound) {
              throw error;
            }

            const createResponse = await apiClient.post<ApiRequest>(`/collections/${collectionId}/requests`, {
              ...request,
            });
            data = createResponse.data;
          }
        }

        set((state) => {
          const collection = state.collections.find((entry) => entry.id === collectionId);
          if (!collection) {
            return;
          }
          const requestIndex = collection.requests.findIndex((entry) => entry.id === request.id);
          if (requestIndex !== -1) {
            collection.requests[requestIndex] = data;
          } else {
            collection.requests.push(data);
          }
          collection.updatedAt = new Date().toISOString();

          state.tabs.forEach((tab) => {
            if (tab.requestState.request.id === request.id) {
              tab.requestState.request = { ...data };
              tab.requestState.collectionId = collectionId;
              tab.requestState.isDirty = false;
            }
          });
        });

        const snapshot = get();
        saveDraftState(snapshot.tabs, snapshot.activeTabId);
        return 'remote';
      }

      const now = new Date().toISOString();
      const savedRequest: ApiRequest = { ...request, updatedAt: now };
      const nextCollections = saveCollectionsLocal(
        get().collections.map((collection) =>
          collection.id === collectionId
            ? {
                ...collection,
                requests: collection.requests.some((entry) => entry.id === request.id)
                  ? collection.requests.map((entry) =>
                      entry.id === request.id ? savedRequest : entry,
                    )
                  : [...collection.requests, savedRequest],
                updatedAt: now,
              }
            : collection,
        ),
      );
      set((state) => {
        state.collections = nextCollections;

        state.tabs.forEach((tab) => {
          if (tab.requestState.request.id === request.id) {
            tab.requestState.request = { ...savedRequest };
            tab.requestState.collectionId = collectionId;
            tab.requestState.isDirty = false;
          }
        });
      });

      const snapshot = get();
      saveDraftState(snapshot.tabs, snapshot.activeTabId);
      return 'local';
    },

    deleteRequestFromCollection: async (collectionId, requestId) => {
      ensureMutationsAllowed(get().authReady);
      ensureCollectionEditable(get(), collectionId);

      if (get().storageMode === 'remote') {
        await apiClient.delete(`/collections/${collectionId}/requests/${requestId}`);
      } else {
        saveCollectionsLocal(
          get().collections.map((collection) =>
            collection.id === collectionId
              ? {
                  ...collection,
                  requests: collection.requests.filter((request) => request.id !== requestId),
                  updatedAt: new Date().toISOString(),
                }
              : collection,
          ),
        );
      }

      set((state) => {
        const collection = state.collections.find((entry) => entry.id === collectionId);
        if (collection) {
          collection.requests = collection.requests.filter((request) => request.id !== requestId);
          collection.updatedAt = new Date().toISOString();
        }
        state.tabs = state.tabs.filter((tab) => tab.requestState.request.id !== requestId);
        if (state.activeTabId && !state.tabs.find((tab) => tab.id === state.activeTabId)) {
          state.activeTabId = state.tabs[0]?.id ?? null;
        }
      });

      const snapshot = get();
      saveDraftState(snapshot.tabs, snapshot.activeTabId);
    },

    importCollection: async (data, format) => {
      ensureMutationsAllowed(get().authReady);

      if (get().storageMode === 'remote') {
        const response = await apiClient.post<Collection>('/collections/import', { data, format });
        set((state) => {
          state.collections.unshift(normalizeCollection(response.data, 'remote'));
        });
        return;
      }

      const payload = data as Partial<Collection>;
      const now = new Date().toISOString();
      const nextCollections = saveCollectionsLocal([
        {
          id: uuidv4(),
          name: payload.name || 'Imported Collection',
          description: payload.description || '',
          requests: (payload.requests || []).map((request) => ({
            ...createDefaultRequest(),
            ...request,
            id: uuidv4(),
            createdAt: now,
            updatedAt: now,
          })),
          folders: payload.folders || [],
          variables: payload.variables || [],
          sharing: defaultSharing(),
          storageScope: 'local',
          createdAt: now,
          updatedAt: now,
        },
        ...get().collections,
      ] as Collection[]);
      set((state) => {
        state.collections = nextCollections;
      });
    },

    updateCollectionShareAccess: async (collectionId, target, access) => {
      if (get().storageMode !== 'remote') {
        throw new Error('Public sharing is only available after sign in');
      }

      const { data } = await apiClient.post<Collection>(`/collections/${collectionId}/share`, {
        target,
        access,
      });
      const normalized = normalizeCollection(data, 'remote');
      set((state) => {
        const index = state.collections.findIndex((collection) => collection.id === collectionId);
        if (index !== -1) {
          state.collections[index] = normalized;
        }
      });
      return normalized;
    },

    loadCollectionMembers: async (collectionId) => {
      if (get().storageMode !== 'remote') {
        throw new Error('Team access is only available after sign in');
      }

      const { data } = await apiClient.get<CollectionMember[]>(`/collections/${collectionId}/members`);
      set((state) => {
        const index = state.collections.findIndex((collection) => collection.id === collectionId);
        if (index !== -1) {
          state.collections[index].collaborators = data;
        }
      });
      return data;
    },

    upsertCollectionMember: async (collectionId, userId, role) => {
      if (get().storageMode !== 'remote') {
        throw new Error('Team access is only available after sign in');
      }

      const { data } = await apiClient.put<CollectionMember[]>(`/collections/${collectionId}/members`, { userId, role });
      set((state) => {
        const index = state.collections.findIndex((collection) => collection.id === collectionId);
        if (index !== -1) {
          state.collections[index].collaborators = data;
        }
      });
      return data;
    },

    removeCollectionMember: async (collectionId, userId) => {
      if (get().storageMode !== 'remote') {
        throw new Error('Team access is only available after sign in');
      }

      const { data } = await apiClient.delete<CollectionMember[]>(`/collections/${collectionId}/members/${encodeURIComponent(userId)}`);
      set((state) => {
        const index = state.collections.findIndex((collection) => collection.id === collectionId);
        if (index !== -1) {
          state.collections[index].collaborators = data;
        }
      });
      return data;
    },

    openShareModal: (collectionId, target) => {
      set((state) => {
        state.shareModalCollectionId = collectionId;
        state.shareModalTarget = target;
        state.showShareModal = true;
      });
    },

    setShowShareModal: (show) => {
      set((state) => {
        state.showShareModal = show;
        if (!show) {
          state.shareModalCollectionId = null;
          state.shareModalTarget = 'collection';
        }
      });
    },

    loadEnvironments: async () => {
      const environments = await loadEnvironmentsByMode(get().storageMode);
      set((state) => {
        state.environments = environments;
        state.activeEnvironmentId = environments.find((environment) => environment.isActive)?.id ?? null;
      });
    },

    createEnvironment: async (name) => {
      ensureMutationsAllowed(get().authReady);

      if (get().storageMode === 'remote') {
        const { data } = await apiClient.post<Environment>('/environments', { name });
        set((state) => {
          state.environments.unshift(normalizeEnvironment(data, 'remote'));
        });
        return;
      }

      const now = new Date().toISOString();
      const nextEnvironments = saveEnvironmentsLocal([
        {
          id: uuidv4(),
          name,
          variables: [],
          isActive: false,
          storageScope: 'local',
          createdAt: now,
          updatedAt: now,
        },
        ...get().environments,
      ] as Environment[]);
      set((state) => {
        state.environments = nextEnvironments;
      });
    },

    updateEnvironment: async (environment) => {
      ensureMutationsAllowed(get().authReady);

      const previousEnvironment = get().environments.find((entry) => entry.id === environment.id);
      const persistableEnvironment = prepareEnvironmentForPersistence(environment);

      // Apply local UI update immediately so typing stays smooth.
      set((state) => {
        const index = state.environments.findIndex((entry) => entry.id === environment.id);
        if (index !== -1) {
          state.environments[index] = {
            ...environment,
            updatedAt: new Date().toISOString(),
            storageScope: state.storageMode,
          };
        }
      });

      if (get().storageMode === 'remote') {
        const nextVersion = (environmentUpdateVersion[environment.id] || 0) + 1;
        environmentUpdateVersion[environment.id] = nextVersion;

        try {
          const { data } = await apiClient.put<Environment>(`/environments/${environment.id}`, persistableEnvironment);

          // Ignore stale responses from older requests to prevent input rollback.
          if (environmentUpdateVersion[environment.id] !== nextVersion) {
            return;
          }

          set((state) => {
            const index = state.environments.findIndex((entry) => entry.id === environment.id);
            if (index !== -1) {
              state.environments[index] = normalizeEnvironment(data, 'remote');
            }
          });
        } catch (error) {
          // Roll back optimistic UI change when remote write fails.
          if (previousEnvironment) {
            set((state) => {
              const index = state.environments.findIndex((entry) => entry.id === environment.id);
              if (index !== -1) {
                state.environments[index] = previousEnvironment;
              }
            });
          }
          throw error;
        }
        return;
      }

      const nextEnvironments = saveEnvironmentsLocal(
        get().environments.map((entry) =>
          entry.id === environment.id
            ? {
                ...persistableEnvironment,
                updatedAt: new Date().toISOString(),
                storageScope: 'local',
              }
            : entry,
        )
      );
      set((state) => {
        state.environments = nextEnvironments;
      });
    },

    deleteEnvironment: async (id) => {
      ensureMutationsAllowed(get().authReady);

      if (get().storageMode === 'remote') {
        await apiClient.delete(`/environments/${id}`);
      } else {
        saveEnvironmentsLocal(get().environments.filter((environment) => environment.id !== id));
      }

      set((state) => {
        state.environments = state.environments.filter((environment) => environment.id !== id);
        if (state.activeEnvironmentId === id) {
          state.activeEnvironmentId = null;
        }
      });
    },

    activateEnvironment: async (id) => {
      ensureMutationsAllowed(get().authReady);

      if (get().storageMode === 'remote') {
        if (!id) {
          set((state) => {
            state.activeEnvironmentId = null;
            state.environments.forEach((environment) => {
              environment.isActive = false;
            });
          });
          return;
        }

        const { data } = await apiClient.post<Environment>(`/environments/${id}/activate`);
        set((state) => {
          state.environments.forEach((environment) => {
            environment.isActive = environment.id === data.id;
          });
          state.activeEnvironmentId = data.id;
        });
        return;
      }

      const nextEnvironments = saveEnvironmentsLocal(
        get().environments.map((environment) => ({
          ...environment,
          isActive: environment.id === id,
          updatedAt: environment.id === id || environment.isActive ? new Date().toISOString() : environment.updatedAt,
        })),
      );
      set((state) => {
        state.environments = nextEnvironments;
        state.activeEnvironmentId = id;
      });
    },

    getActiveEnvironment: () => {
      const { environments, activeEnvironmentId } = get();
      return environments.find((environment) => environment.id === activeEnvironmentId) ?? null;
    },

    resolveVariables: (text) => {
      const environment = get().getActiveEnvironment();
      if (!environment) {
        return text;
      }

      return text.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
        const variable = environment.variables.find((entry) => entry.key === key.trim() && entry.enabled);
        return variable ? variable.value : match;
      });
    },

    openTab: (request, collectionId) => {
      set((state) => {
        const existing = state.tabs.find((tab) => tab.requestState.request.id === request.id);
        if (existing) {
          state.activeTabId = existing.id;
          state.showInterceptPanel = false;
          return;
        }

        const nextTab: AppTab = {
          id: uuidv4(),
          requestState: {
            request: { ...request },
            collectionId,
            isDirty: false,
          },
        };
        state.tabs.push(nextTab);
        state.activeTabId = nextTab.id;
        state.showInterceptPanel = false;
      });

      const snapshot = get();
      saveDraftState(snapshot.tabs, snapshot.activeTabId);
    },

    closeTab: (tabId, options) => {
      const targetTab = get().tabs.find((tab) => tab.id === tabId);
      if (!targetTab) {
        return;
      }

      if (targetTab.requestState.isDirty && !options?.skipConfirm) {
        set((state) => {
          state.pendingCloseTabId = tabId;
        });
        return;
      }

      set((state) => {
        const index = state.tabs.findIndex((tab) => tab.id === tabId);
        if (index === -1) {
          return;
        }
        state.tabs.splice(index, 1);
        delete state.responses[tabId];
        delete state.postRequestAssertions[tabId];
        if (state.pendingCloseTabId === tabId) {
          state.pendingCloseTabId = null;
        }
        if (state.activeTabId === tabId) {
          state.activeTabId = state.tabs[Math.max(0, index - 1)]?.id ?? state.tabs[0]?.id ?? null;
        }
      });

      const snapshot = get();
      saveDraftState(snapshot.tabs, snapshot.activeTabId);
    },

    confirmCloseTab: () => {
      const pendingId = get().pendingCloseTabId;
      if (!pendingId) {
        return;
      }

      get().closeTab(pendingId, { skipConfirm: true });
    },

    cancelCloseTab: () => {
      set((state) => {
        state.pendingCloseTabId = null;
      });
    },

    setActiveTab: (tabId) => {
      set((state) => {
        state.activeTabId = tabId;
        state.showInterceptPanel = false;
      });

      const snapshot = get();
      saveDraftState(snapshot.tabs, snapshot.activeTabId);
    },

    reorderTabs: (sourceTabId, targetTabId) => {
      if (sourceTabId === targetTabId) {
        return;
      }

      set((state) => {
        const sourceIndex = state.tabs.findIndex((tab) => tab.id === sourceTabId);
        const targetIndex = state.tabs.findIndex((tab) => tab.id === targetTabId);

        if (sourceIndex === -1 || targetIndex === -1 || sourceIndex === targetIndex) {
          return;
        }

        const [movedTab] = state.tabs.splice(sourceIndex, 1);
        state.tabs.splice(targetIndex, 0, movedTab);
      });

      const snapshot = get();
      saveDraftState(snapshot.tabs, snapshot.activeTabId);
    },

    updateActiveRequest: (updates) => {
      set((state) => {
        const tab = state.tabs.find((entry) => entry.id === state.activeTabId);
        if (!tab) {
          return;
        }
        Object.assign(tab.requestState.request, updates);
        tab.requestState.isDirty = true;
      });

      const snapshot = get();
      saveDraftState(snapshot.tabs, snapshot.activeTabId);
    },

    openNewTab: () => {
      get().openTab(createDefaultRequest());
    },

    replayHistoryEntry: async (historyId) => {
      const entry = get().requestHistory.find((item) => item.id === historyId);
      if (!entry) {
        throw new Error('History entry not found');
      }

      const now = new Date().toISOString();
      const replayRequest: ApiRequest = {
        ...cloneJson(entry.request),
        id: uuidv4(),
        createdAt: now,
        updatedAt: now,
      };

      get().openTab(replayRequest, entry.collectionId);
      const tabId = get().activeTabId;
      if (tabId) {
        await get().sendRequest(tabId);
      }
    },

    clearRequestHistory: () => {
      set((state) => {
        state.requestHistory = [];
      });
      saveRequestHistory([]);
    },

    runCollection: async (collectionId) => {
      const collection = get().collections.find((entry) => entry.id === collectionId);
      if (!collection) {
        throw new Error('Collection not found');
      }

      const resolveVariables = (text: string) => {
        const stateResolver = get().resolveVariables;
        const resolvedByState = stateResolver(text);
        return resolvedByState;
      };

      const persistEnvironmentValues = async (values: Record<string, string>) => {
        const activeEnvironmentId = get().activeEnvironmentId;
        if (!activeEnvironmentId) {
          return;
        }

        const activeEnvironment = get().environments.find((env) => env.id === activeEnvironmentId);
        if (!activeEnvironment) {
          return;
        }

        const currentMap = buildEnvironmentValueMap(activeEnvironment);
        const currentKeys = Object.keys(currentMap);
        const nextKeys = Object.keys(values);
        const sameShape = currentKeys.length === nextKeys.length && currentKeys.every((key) => values[key] === currentMap[key]);
        if (sameShape) {
          return;
        }

        const originalEnabledKeys = new Set(activeEnvironment.variables.filter((item) => item.enabled && item.key).map((item) => item.key));
        const nextVariables = activeEnvironment.variables
          .filter((item) => !(originalEnabledKeys.has(item.key) && !Object.prototype.hasOwnProperty.call(values, item.key)))
          .map((item) => {
            if (!item.key) {
              return item;
            }

            if (!Object.prototype.hasOwnProperty.call(values, item.key)) {
              return item;
            }

            return {
              ...item,
              value: values[item.key],
              initialValue: values[item.key],
              enabled: true,
            };
          });

        Object.entries(values).forEach(([key, value]) => {
          if (!nextVariables.some((item) => item.key === key)) {
            nextVariables.push({
              id: uuidv4(),
              key,
              value,
              initialValue: value,
              enabled: true,
            });
          }
        });

        const updatedEnvironment: Environment = {
          ...activeEnvironment,
          variables: nextVariables,
          updatedAt: new Date().toISOString(),
        };

        set((state) => {
          const index = state.environments.findIndex((env) => env.id === activeEnvironment.id);
          if (index !== -1) {
            state.environments[index] = updatedEnvironment;
          }
        });

        try {
          if (get().storageMode === 'remote') {
            await apiClient.put<Environment>(`/environments/${updatedEnvironment.id}`, prepareEnvironmentForPersistence(updatedEnvironment));
          } else {
            saveEnvironmentsLocal(get().environments);
          }
        } catch {
          // Non-blocking persistence for script-driven variable updates.
        }
      };

      const startedAt = new Date().toISOString();
      const results: CollectionRunItemResult[] = [];
      let runtimeEnvironmentValues = buildEnvironmentValueMap(get().getActiveEnvironment());

      for (const request of collection.requests) {
        const runStart = Date.now();
        let response: ProxyResponse;
        let assertions: CollectionRunAssertion[] = [];

        try {
          let payload = buildRequestPayload(request, (text) => resolveWithMap(resolveVariables(text), runtimeEnvironmentValues));

          const preResult = await executeApikScript({
            stage: 'pre-request',
            script: request.preRequestScript,
            request: payload,
            environmentValues: runtimeEnvironmentValues,
            collectAssertions: false,
          });

          runtimeEnvironmentValues = preResult.environmentValues;
          await persistEnvironmentValues(runtimeEnvironmentValues);

          if (preResult.error) {
            throw new Error(`Pre-request script failed: ${preResult.error}`);
          }

          payload = preResult.request;

          response = await sendRequestWithSmartTransport({
            method: payload.method,
            url: payload.url,
            headers: payload.headers,
            body: payload.body,
            timeout: 30000,
          });

          const postResult = await executeApikScript({
            stage: 'post-request',
            script: request.testScript,
            request: payload,
            response,
            environmentValues: runtimeEnvironmentValues,
            collectAssertions: true,
          });

          runtimeEnvironmentValues = postResult.environmentValues;
          await persistEnvironmentValues(runtimeEnvironmentValues);
          assertions = postResult.assertions;

          if (postResult.error) {
            assertions = [
              ...assertions,
              {
                name: 'Post-request script',
                passed: false,
                error: postResult.error,
              },
            ];
          }
        } catch (error) {
          response = {
            status: 0,
            statusText: 'Error',
            headers: {},
            body: error instanceof Error ? error.message : 'Request failed',
            size: 0,
            time: Date.now() - runStart,
            error: error instanceof Error ? error.message : 'Request failed',
          };
          assertions = [
            {
              name: 'Request execution',
              passed: false,
              error: response.error || 'Request failed',
            },
          ];
        }
        const passed = assertions.every((assertion) => assertion.passed) && !response.error;

        results.push({
          requestId: request.id,
          requestName: request.name,
          method: request.method,
          url: request.url,
          status: response.status,
          durationMs: Date.now() - runStart,
          passed,
          assertions,
          error: response.error,
        });
      }

      const finishedAt = new Date().toISOString();
      const passedCount = results.filter((item) => item.passed).length;
      const report: CollectionRunReport = {
        id: uuidv4(),
        collectionId,
        startedAt,
        finishedAt,
        total: results.length,
        passed: passedCount,
        failed: results.length - passedCount,
        results,
      };

      const auditEntry: AuditLogEntry = {
        id: uuidv4(),
        actorUserId: get().userId,
        action: 'collection.run',
        createdAt: new Date().toISOString(),
        details: {
          collectionId,
          total: String(report.total),
          failed: String(report.failed),
        },
      };

      set((state) => {
        const target = state.collections.find((entry) => entry.id === collectionId);
        if (!target) {
          return;
        }

        target.runReports = [report, ...(target.runReports || [])].slice(0, 50);
        target.auditLog = [auditEntry, ...(target.auditLog || [])].slice(0, 200);
        target.updatedAt = new Date().toISOString();
      });

      if (get().storageMode === 'remote') {
        const target = get().collections.find((entry) => entry.id === collectionId);
        if (target) {
          await apiClient.put<Collection>(`/collections/${collectionId}`, {
            runReports: target.runReports || [],
            auditLog: target.auditLog || [],
          });
        }
      } else {
        saveCollectionsLocal(get().collections);
      }

      return report;
    },

    getRequestDiff: (tabId) => {
      const tab = get().tabs.find((entry) => entry.id === tabId);
      if (!tab || !tab.requestState.collectionId) {
        return [];
      }

      const collection = get().collections.find((entry) => entry.id === tab.requestState.collectionId);
      const persisted = collection?.requests.find((entry) => entry.id === tab.requestState.request.id);
      if (!persisted) {
        return ['Request is new (not saved in collection yet)'];
      }

      const current = tab.requestState.request;
      const diffs: string[] = [];
      compareFieldDiff('Name', persisted.name, current.name, diffs);
      compareFieldDiff('Method', persisted.method, current.method, diffs);
      compareFieldDiff('URL', persisted.url, current.url, diffs);
      compareFieldDiff('Params', persisted.params, current.params, diffs);
      compareFieldDiff('Headers', persisted.headers, current.headers, diffs);
      compareFieldDiff('Body', persisted.body, current.body, diffs);
      compareFieldDiff('Auth', persisted.auth, current.auth, diffs);
      compareFieldDiff('Pre-request Script', persisted.preRequestScript || '', current.preRequestScript || '', diffs);
      compareFieldDiff('Test Script', persisted.testScript || '', current.testScript || '', diffs);
      compareFieldDiff('Description', persisted.description || '', current.description || '', diffs);
      compareFieldDiff('Retry Policy', persisted.retryPolicy || null, current.retryPolicy || null, diffs);

      return diffs;
    },

    saveResponseAsMockExample: async (tabId) => {
      const tab = get().tabs.find((entry) => entry.id === tabId);
      if (!tab || !tab.requestState.collectionId) {
        throw new Error('Open a saved collection request first');
      }

      const response = get().responses[tabId];
      if (!response) {
        throw new Error('No response available to save as mock example');
      }

      const request = tab.requestState.request;
      const nextExamples = [
        cloneJson(response),
        ...((request.mockExamples || []).map((entry) => cloneJson(entry))),
      ].slice(0, 10);

      await get().updateRequestInCollection(tab.requestState.collectionId, {
        ...request,
        mockExamples: nextExamples,
      });

      set((state) => {
        const collection = state.collections.find((entry) => entry.id === tab.requestState.collectionId);
        const collectionRequest = collection?.requests.find((entry) => entry.id === request.id);
        if (collectionRequest) {
          collectionRequest.mockExamples = nextExamples;
        }

        const updatedTab = state.tabs.find((entry) => entry.id === tabId);
        if (updatedTab) {
          updatedTab.requestState.request.mockExamples = nextExamples;
          updatedTab.requestState.isDirty = false;
        }
      });

      const snapshot = get();
      saveDraftState(snapshot.tabs, snapshot.activeTabId);
    },

    loadMockExampleForTab: (tabId, index) => {
      const tab = get().tabs.find((entry) => entry.id === tabId);
      if (!tab) {
        return;
      }

      const examples = tab.requestState.request.mockExamples || [];
      const selected = examples[index];
      if (!selected) {
        return;
      }

      set((state) => {
        state.responses[tabId] = cloneJson(selected);
      });
    },

    deleteMockExampleFromRequest: async (tabId, index) => {
      const tab = get().tabs.find((entry) => entry.id === tabId);
      if (!tab || !tab.requestState.collectionId) {
        throw new Error('Open a saved collection request first');
      }

      const request = tab.requestState.request;
      const existing = request.mockExamples || [];
      if (index < 0 || index >= existing.length) {
        return;
      }

      const nextExamples = existing.filter((_, itemIndex) => itemIndex !== index).map((entry) => cloneJson(entry));

      await get().updateRequestInCollection(tab.requestState.collectionId, {
        ...request,
        mockExamples: nextExamples,
      });

      set((state) => {
        const updatedTab = state.tabs.find((entry) => entry.id === tabId);
        if (updatedTab) {
          updatedTab.requestState.request.mockExamples = nextExamples;
          updatedTab.requestState.isDirty = false;
        }
      });

      const snapshot = get();
      saveDraftState(snapshot.tabs, snapshot.activeTabId);
    },

    deleteMockExampleFromDocs: async (collectionId, requestId, index) => {
      const collection = get().collections.find((entry) => entry.id === collectionId);
      const request = collection?.requests.find((entry) => entry.id === requestId);
      if (!request) {
        throw new Error('Request not found in collection');
      }

      const existing = request.mockExamples || [];
      if (index < 0 || index >= existing.length) {
        return;
      }

      const nextExamples = existing.filter((_, itemIndex) => itemIndex !== index).map((entry) => cloneJson(entry));
      await get().updateRequestInCollection(collectionId, {
        ...request,
        mockExamples: nextExamples,
      });

      set((state) => {
        const targetCollection = state.collections.find((entry) => entry.id === collectionId);
        const targetRequest = targetCollection?.requests.find((entry) => entry.id === requestId);
        if (targetRequest) {
          targetRequest.mockExamples = nextExamples;
        }
      });
    },

    sendRequest: async (tabId) => {
      const { tabs, resolveVariables } = get();
      const tab = tabs.find((entry) => entry.id === tabId);
      if (!tab) {
        return;
      }

      const request = tab.requestState.request;
      const requestSnapshot = cloneJson(request);
      set((state) => {
        state.loadingTabs.add(tabId);
        state.postRequestAssertions[tabId] = [];
      });

      let resolvedUrlForHistory = request.url;

      const persistEnvironmentValues = async (values: Record<string, string>) => {
        const activeEnvironmentId = get().activeEnvironmentId;
        if (!activeEnvironmentId) {
          return;
        }

        const activeEnvironment = get().environments.find((env) => env.id === activeEnvironmentId);
        if (!activeEnvironment) {
          return;
        }

        const currentMap = buildEnvironmentValueMap(activeEnvironment);
        const currentKeys = Object.keys(currentMap);
        const nextKeys = Object.keys(values);
        const sameShape = currentKeys.length === nextKeys.length && currentKeys.every((key) => values[key] === currentMap[key]);
        if (sameShape) {
          return;
        }

        const originalEnabledKeys = new Set(activeEnvironment.variables.filter((item) => item.enabled && item.key).map((item) => item.key));
        const nextVariables = activeEnvironment.variables
          .filter((item) => !(originalEnabledKeys.has(item.key) && !Object.prototype.hasOwnProperty.call(values, item.key)))
          .map((item) => {
            if (!item.key) {
              return item;
            }

            if (!Object.prototype.hasOwnProperty.call(values, item.key)) {
              return item;
            }

            return {
              ...item,
              value: values[item.key],
              initialValue: values[item.key],
              enabled: true,
            };
          });

        Object.entries(values).forEach(([key, value]) => {
          if (!nextVariables.some((item) => item.key === key)) {
            nextVariables.push({
              id: uuidv4(),
              key,
              value,
              initialValue: value,
              enabled: true,
            });
          }
        });

        const updatedEnvironment: Environment = {
          ...activeEnvironment,
          variables: nextVariables,
          updatedAt: new Date().toISOString(),
        };

        set((state) => {
          const index = state.environments.findIndex((env) => env.id === activeEnvironment.id);
          if (index !== -1) {
            state.environments[index] = updatedEnvironment;
          }
        });

        try {
          if (get().storageMode === 'remote') {
            await apiClient.put<Environment>(`/environments/${updatedEnvironment.id}`, prepareEnvironmentForPersistence(updatedEnvironment));
          } else {
            saveEnvironmentsLocal(get().environments);
          }
        } catch {
          // Non-blocking persistence for script-driven variable updates.
        }
      };

      try {
        const initialEnvironmentValues = buildEnvironmentValueMap(get().getActiveEnvironment());
        const basePayload = buildRequestPayload(request, (text) => resolveWithMap(resolveVariables(text), initialEnvironmentValues));

        const preResult = await executeApikScript({
          stage: 'pre-request',
          script: request.preRequestScript,
          request: basePayload,
          environmentValues: initialEnvironmentValues,
          collectAssertions: false,
        });

        if (preResult.error) {
          throw new Error(`Pre-request script failed: ${preResult.error}`);
        }

        await persistEnvironmentValues(preResult.environmentValues);

        const scriptReadyPayload = preResult.request;
        resolvedUrlForHistory = scriptReadyPayload.url;

        const policy = request.retryPolicy || {
          retries: 0,
          retryDelayMs: 500,
          retryOnStatuses: [408, 429, 500, 502, 503, 504],
          circuitBreakerThreshold: 3,
          circuitBreakerCooldownMs: 30000,
        };

        const failureState = requestFailureState[request.id] || { failures: 0, blockedUntil: 0 };
        if (failureState.blockedUntil > Date.now()) {
          throw new Error('Circuit breaker is open for this request. Please try again later.');
        }

        let data: ProxyResponse | null = null;
        let lastError: Error | null = null;
        const retryStatuses = policy.retryOnStatuses || [408, 429, 500, 502, 503, 504];

        for (let attempt = 0; attempt <= Math.max(0, policy.retries || 0); attempt += 1) {
          try {
            const current = await sendRequestWithSmartTransport({
              method: scriptReadyPayload.method,
              url: scriptReadyPayload.url,
              headers: scriptReadyPayload.headers,
              body: scriptReadyPayload.body,
              timeout: 30000,
            });

            if (shouldRetryStatus(current.status, retryStatuses) && attempt < (policy.retries || 0)) {
              await sleep(Math.max(0, policy.retryDelayMs || 0));
              continue;
            }

            data = current;
            break;
          } catch (error) {
            lastError = error instanceof Error ? error : new Error('Request failed');
            if (attempt >= (policy.retries || 0)) {
              throw lastError;
            }
            await sleep(Math.max(0, policy.retryDelayMs || 0));
          }
        }

        if (!data) {
          throw lastError || new Error('Request failed');
        }

        const postResult = await executeApikScript({
          stage: 'post-request',
          script: request.testScript,
          request: scriptReadyPayload,
          response: data,
          environmentValues: preResult.environmentValues,
          collectAssertions: true,
        });

        set((state) => {
          state.postRequestAssertions[tabId] = postResult.assertions;
        });

        await persistEnvironmentValues(postResult.environmentValues);

        const failedAssertions = postResult.assertions.filter((assertion) => !assertion.passed);
        if (postResult.error || failedAssertions.length > 0) {
          const parts: string[] = [];
          if (failedAssertions.length > 0) {
            parts.push(`Post-request assertions failed: ${failedAssertions.length}/${postResult.assertions.length}`);
          }
          if (postResult.error) {
            parts.push(`Post-request script error: ${postResult.error}`);
          }
          data = {
            ...data,
            error: parts.join(' | '),
          };
        }

        if (data.status >= 200 && data.status < 400) {
          requestFailureState[request.id] = { failures: 0, blockedUntil: 0 };
        } else {
          const nextFailures = (failureState.failures || 0) + 1;
          const threshold = Math.max(1, policy.circuitBreakerThreshold || 3);
          requestFailureState[request.id] = {
            failures: nextFailures,
            blockedUntil: nextFailures >= threshold ? Date.now() + Math.max(1000, policy.circuitBreakerCooldownMs || 30000) : 0,
          };
        }

        set((state) => {
          state.responses[tabId] = data;
          state.requestHistory.unshift({
            id: uuidv4(),
            tabId,
            collectionId: tab.requestState.collectionId,
            timestamp: new Date().toISOString(),
            request: cloneJson(requestSnapshot),
            resolvedUrl: resolvedUrlForHistory,
            response: cloneJson(data),
          });
          if (state.requestHistory.length > MAX_HISTORY_ITEMS) {
            state.requestHistory = state.requestHistory.slice(0, MAX_HISTORY_ITEMS);
          }
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Request failed';
        const localhostHint = /localhost request failed|local api allows cors|private network access/i.test(message)
          ? '\n\nTips: open local API with CORS enabled for this origin, or use HTTP API from localhost page.'
          : '';
        const errorResponse: ProxyResponse = {
          status: 0,
          statusText: 'Error',
          headers: {},
          body: `Request failed: ${message}${localhostHint}`,
          size: 0,
          time: 0,
          error: message,
        };
        set((state) => {
          state.responses[tabId] = errorResponse;
          state.postRequestAssertions[tabId] = [];
          state.requestHistory.unshift({
            id: uuidv4(),
            tabId,
            collectionId: tab.requestState.collectionId,
            timestamp: new Date().toISOString(),
            request: cloneJson(requestSnapshot),
            resolvedUrl: resolvedUrlForHistory,
            response: cloneJson(errorResponse),
          });
          if (state.requestHistory.length > MAX_HISTORY_ITEMS) {
            state.requestHistory = state.requestHistory.slice(0, MAX_HISTORY_ITEMS);
          }
        });
      } finally {
        set((state) => {
          state.loadingTabs.delete(tabId);
        });

        const snapshot = get();
        saveDraftState(snapshot.tabs, snapshot.activeTabId);
        saveRequestHistory(snapshot.requestHistory);
      }
    },

    setInterceptEnabled: (enabled) => {
      const stateSnapshot = get();
      if (!stateSnapshot.isAuthenticated || !stateSnapshot.userId) {
        desiredInterceptEnabled = false;
        set((state) => {
          state.interceptEnabled = false;
        });
        return;
      }

      desiredInterceptEnabled = enabled;
      set((state) => {
        state.interceptEnabled = enabled;
        if (enabled) {
          state.interceptTabOpen = true;
          state.showInterceptPanel = true;
        }
      });
      wsInstance?.send(JSON.stringify({ type: 'SET_INTERCEPT', enabled }));
    },

    forwardInterceptedRequest: (id, modified) => {
      wsInstance?.send(JSON.stringify({ type: 'FORWARD_REQUEST', id, modifiedRequest: modified }));
      set((state) => {
        const target = state.interceptedRequests.find((request) => request.id === id);
        if (target) {
          target.status = 'forwarded';
          target.timestamp = Date.now();
        }
        state.interceptedRequests.sort((a, b) => b.timestamp - a.timestamp);
        if (state.interceptedRequests.length > 500) {
          state.interceptedRequests = state.interceptedRequests.slice(0, 500);
        }
      });
    },

    dropInterceptedRequest: (id) => {
      wsInstance?.send(JSON.stringify({ type: 'DROP_REQUEST', id }));
      set((state) => {
        const target = state.interceptedRequests.find((request) => request.id === id);
        if (target) {
          target.status = 'dropped';
          target.timestamp = Date.now();
        }
        state.interceptedRequests.sort((a, b) => b.timestamp - a.timestamp);
        if (state.interceptedRequests.length > 500) {
          state.interceptedRequests = state.interceptedRequests.slice(0, 500);
        }
      });
    },

    clearInterceptedRequests: () => {
      wsInstance?.send(JSON.stringify({ type: 'CLEAR_INTERCEPTS' }));
      set((state) => {
        state.interceptedRequests = [];
      });
    },

    initWebSocket: async () => {
      const stateSnapshot = get();
      if (!stateSnapshot.authReady || !stateSnapshot.isAuthenticated || !stateSnapshot.userId) {
        teardownInterceptSocket();
        set((state) => {
          state.wsConnected = false;
          state.interceptEnabled = false;
          state.interceptedRequests = [];
        });
        return;
      }

      if (wsInstance && (wsInstance.readyState === WebSocket.OPEN || wsInstance.readyState === WebSocket.CONNECTING)) {
        return;
      }

      try {
        clearReconnectTimer();
        const { data } = await apiClient.get<{ ticket: string }>('/intercept/session');
        const ticket = typeof data?.ticket === 'string' ? data.ticket : '';
        if (!ticket) {
          throw new Error('Missing intercept session ticket');
        }

        const socket = new WebSocket(getWsInterceptUrl(ticket));
        wsInstance = socket;

        socket.onopen = () => {
          if (wsInstance !== socket) {
            return;
          }

          clearReconnectTimer();
          wsReconnectDelay = 1000; // Reset backoff on successful connection
          set((state) => {
            state.wsConnected = true;
          });

          if (desiredInterceptEnabled) {
            try {
              socket.send(JSON.stringify({ type: 'SET_INTERCEPT', enabled: true }));
            } catch {
              // Ignore write failure and let reconnect logic retry.
            }
          }

          // Heartbeat to keep connection alive and detect broken sockets
          const pingInterval = window.setInterval(() => {
            if (socket.readyState === WebSocket.OPEN) {
              try { socket.send(JSON.stringify({ type: 'PING' })); } catch { /* ignore */ }
            } else {
              window.clearInterval(pingInterval);
            }
          }, 25000);
          socket.addEventListener('close', () => window.clearInterval(pingInterval), { once: true });
        };

        socket.onclose = () => {
          if (wsInstance !== socket) {
            return;
          }

          wsInstance = null;
          set((state) => {
            state.wsConnected = false;
          });
          if (get().authReady && get().isAuthenticated && get().userId) {
            scheduleReconnect(() => {
              void get().initWebSocket();
            });
          }
        };

        socket.onerror = () => {
          if (wsInstance !== socket) {
            return;
          }

          set((state) => {
            state.wsConnected = false;
          });
        };

        socket.onmessage = (event) => {
          if (wsInstance !== socket) {
            return;
          }

          try {
            const message = JSON.parse(event.data);
            switch (message.type) {
              case 'STATE':
                {
                  const serverEnabled = Boolean(message.interceptEnabled);
                  if (desiredInterceptEnabled && !serverEnabled) {
                    try {
                      socket.send(JSON.stringify({ type: 'SET_INTERCEPT', enabled: true }));
                    } catch {
                      // Ignore write failure and let reconnect logic retry.
                    }
                  }
                }
                set((state) => {
                  state.interceptEnabled = desiredInterceptEnabled || Boolean(message.interceptEnabled);
                  const pendingRequests = Array.isArray(message.pendingRequests)
                    ? (message.pendingRequests as InterceptedRequest[])
                    : [];
                  // Preserve ALL existing history (non-pending requests) across reconnects
                  const existingNonPending = state.interceptedRequests.filter(
                    (request) => request.status !== 'pending',
                  );
                  const merged = [...pendingRequests];
                  for (const existing of existingNonPending) {
                    if (!merged.some((request) => request.id === existing.id)) {
                      merged.push(existing);
                    }
                  }
                  state.interceptedRequests = merged
                    .sort((a, b) => b.timestamp - a.timestamp)
                    .slice(0, 500);
                });
                break;
              case 'INTERCEPT_STATE':
                desiredInterceptEnabled = Boolean(message.enabled);
                set((state) => {
                  state.interceptEnabled = message.enabled;
                });
                break;
              case 'NEW_INTERCEPTED_REQUEST':
                set((state) => {
                  const incoming = message.request as InterceptedRequest;
                  const existingIndex = state.interceptedRequests.findIndex((request) => request.id === incoming.id);
                  if (existingIndex >= 0) {
                    state.interceptedRequests[existingIndex] = {
                      ...state.interceptedRequests[existingIndex],
                      ...incoming,
                    };
                  } else {
                    state.interceptedRequests.push(incoming);
                  }
                  state.interceptedRequests.sort((a, b) => b.timestamp - a.timestamp);
                  if (state.interceptedRequests.length > 500) {
                    state.interceptedRequests = state.interceptedRequests.slice(0, 500);
                  }
                });
                break;
              case 'INTERCEPT_HEADERS_UPDATED':
                set((state) => {
                  const target = state.interceptedRequests.find((request) => request.id === message.id);
                  if (target) {
                    target.headers = {
                      ...target.headers,
                      ...(message.headers || {}),
                    };
                  }
                });
                break;
              case 'REQUEST_FORWARDED':
                set((state) => {
                  const target = state.interceptedRequests.find((request) => request.id === message.id);
                  if (target) {
                    target.status = 'forwarded';
                    target.timestamp = Date.now();
                  }
                  state.interceptedRequests.sort((a, b) => b.timestamp - a.timestamp);
                });
                break;
              case 'REQUEST_DROPPED':
                set((state) => {
                  const target = state.interceptedRequests.find((request) => request.id === message.id);
                  if (target) {
                    target.status = 'dropped';
                    target.timestamp = Date.now();
                  }
                  state.interceptedRequests.sort((a, b) => b.timestamp - a.timestamp);
                });
                break;
              case 'MOBILE_PROXY_RESPONSE':
                set((state) => {
                  const target = state.interceptedRequests.find((request) => request.id === message.id);
                  if (!target) {
                    return;
                  }
                  target.responseStatusCode = typeof message.statusCode === 'number' ? message.statusCode : undefined;
                  target.responseHeaders = (message.headers as Record<string, string>) || {};
                  target.responseBody = typeof message.body === 'string' ? message.body : undefined;
                  target.responseTimestamp = typeof message.timestamp === 'number' ? message.timestamp : Date.now();
                });
                break;
              case 'INTERCEPTS_CLEARED':
                set((state) => {
                  state.interceptedRequests = [];
                });
                break;
            }
          } catch {
            // Ignore malformed websocket payloads.
          }
        };
      } catch {
        // Don't clear history on connection failure — keep history across reconnects
        set((state) => {
          state.wsConnected = false;
        });

        if (get().authReady && get().isAuthenticated && get().userId) {
          scheduleReconnect(() => {
            void get().initWebSocket();
          });
        }
        return;
      }
    },

    setShowEnvModal: (show) => {
      set((state) => {
        state.showEnvModal = show;
      });
    },

    setShowInterceptPanel: (show) => {
      set((state) => {
        state.showInterceptPanel = show;
        if (show) {
          state.interceptTabOpen = true;
        }
      });
    },

    closeInterceptTab: () => {
      set((state) => {
        state.showInterceptPanel = false;
        state.interceptTabOpen = false;
      });
    },

    setShowDocViewer: (show, collectionId) => {
      set((state) => {
        state.showDocViewer = show;
        state.docViewerCollection = collectionId ?? null;
      });
    },

    setShowImportModal: (show) => {
      set((state) => {
        state.showImportModal = show;
      });
    },

    setSearchQuery: (query) => {
      set((state) => {
        state.searchQuery = query;
      });
    },

    setInterceptSearchQuery: (query) => {
      set((state) => {
        state.interceptSearchQuery = query;
      });
    },
  })),
);