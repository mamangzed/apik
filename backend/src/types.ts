export interface KeyValuePair {
  id: string;
  key: string;
  value: string;
  description?: string;
  enabled: boolean;
}

export interface RequestBody {
  type: 'none' | 'json' | 'form-data' | 'form-urlencoded' | 'xml' | 'text' | 'binary' | 'graphql';
  content: string;
  formData?: KeyValuePair[];
}

export interface AuthConfig {
  type: 'none' | 'bearer' | 'basic' | 'api-key' | 'oauth2';
  token?: string;
  username?: string;
  password?: string;
  key?: string;
  value?: string;
  addTo?: 'header' | 'query';
}

export interface RetryPolicy {
  retries: number;
  retryDelayMs: number;
  retryOnStatuses?: number[];
  circuitBreakerThreshold?: number;
  circuitBreakerCooldownMs?: number;
}

export interface CollectionRunAssertion {
  name: string;
  passed: boolean;
  error?: string;
}

export interface CollectionRunItemResult {
  requestId: string;
  requestName: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
  url: string;
  status: number;
  durationMs: number;
  passed: boolean;
  assertions: CollectionRunAssertion[];
  error?: string;
}

export interface CollectionRunReport {
  id: string;
  collectionId: string;
  startedAt: string;
  finishedAt: string;
  total: number;
  passed: number;
  failed: number;
  results: CollectionRunItemResult[];
}

export interface AuditLogEntry {
  id: string;
  actorUserId?: string | null;
  action: string;
  createdAt: string;
  details?: Record<string, string>;
}

export type VisibilityMode = 'private' | 'public';
export type CollectionMemberRole = 'editor' | 'viewer';
export type CollectionAccessRole = 'owner' | CollectionMemberRole;

export interface CollectionMember {
  userId: string;
  role: CollectionMemberRole;
  invitedBy?: string;
  createdAt: string;
}

export interface ShareSettings {
  access: VisibilityMode;
  token: string | null;
}

export interface CollectionSharing {
  collection: ShareSettings;
  docs: ShareSettings;
}

export interface ApiRequest {
  id: string;
  name: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
  url: string;
  params: KeyValuePair[];
  headers: KeyValuePair[];
  body: RequestBody;
  auth: AuthConfig;
  preRequestScript?: string;
  testScript?: string;
  retryPolicy?: RetryPolicy;
  mockExamples?: ProxyResponse[];
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Collection {
  id: string;
  name: string;
  description?: string;
  requests: ApiRequest[];
  folders: CollectionFolder[];
  variables?: KeyValuePair[];
  sharing: CollectionSharing;
  collaborators?: CollectionMember[];
  currentUserRole?: CollectionAccessRole;
  ownerUserId?: string;
  storageScope?: 'local' | 'remote';
  runReports?: CollectionRunReport[];
  auditLog?: AuditLogEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface CollectionFolder {
  id: string;
  name: string;
  requests: ApiRequest[];
  folders: CollectionFolder[];
}

export interface Environment {
  id: string;
  name: string;
  variables: KeyValuePair[];
  isActive: boolean;
  ownerUserId?: string;
  storageScope?: 'local' | 'remote';
  createdAt: string;
  updatedAt: string;
}

export interface ProxyRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string | null;
  timeout?: number;
  followRedirects?: boolean;
}

export interface ProxyResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  size: number;
  time: number;
  redirected?: boolean;
}

export interface InterceptedRequest {
  id: string;
  tabId?: number;
  tabUrl?: string;
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
  timestamp: number;
  status: 'pending' | 'forwarded' | 'dropped' | 'modified';
  source?: string;
  responseStatusCode?: number;
  responseHeaders?: Record<string, string>;
  responseBody?: string;
  responseTimestamp?: number;
}

export interface StorageData {
  collections: Collection[];
  environments: Environment[];
}

export interface PublicCollectionResponse {
  id: string;
  name: string;
  description?: string;
  requests: ApiRequest[];
  folders: CollectionFolder[];
  variables?: KeyValuePair[];
  sharing: {
    collection: { access: VisibilityMode };
    docs: { access: VisibilityMode };
  };
  createdAt: string;
  updatedAt: string;
}
