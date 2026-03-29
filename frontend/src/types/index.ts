export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

export interface KeyValuePair {
  id: string;
  key: string;
  value: string;
  description?: string;
  enabled: boolean;
}

export type BodyType = 'none' | 'json' | 'form-data' | 'form-urlencoded' | 'xml' | 'text' | 'graphql';

export interface RequestBody {
  type: BodyType;
  content: string;
  formData?: KeyValuePair[];
}

export type AuthType = 'none' | 'bearer' | 'basic' | 'api-key' | 'oauth2';

export interface AuthConfig {
  type: AuthType;
  token?: string;
  username?: string;
  password?: string;
  key?: string;
  value?: string;
  addTo?: 'header' | 'query';
}

export type RequestFormFieldType =
  | 'text'
  | 'password'
  | 'number'
  | 'textarea'
  | 'select'
  | 'checkbox'
  | 'radio'
  | 'email'
  | 'tel'
  | 'url'
  | 'date'
  | 'time'
  | 'datetime-local'
  | 'range'
  | 'color'
  | 'file'
  | 'address'
  | 'json';
export type RequestFormFieldTarget =
  | 'param'
  | 'header'
  | 'body-json'
  | 'body-form'
  | 'auth-token'
  | 'auth-username'
  | 'auth-password'
  | 'auth-api-key-value';

export interface RequestFormFieldOption {
  id: string;
  label: string;
  value: string;
}

export interface RequestFormField {
  id: string;
  name: string;
  label: string;
  type: RequestFormFieldType;
  layoutWidth?: 'half' | 'full';
  required?: boolean;
  target: RequestFormFieldTarget;
  targetKey: string;
  placeholder?: string;
  defaultValue?: string;
  description?: string;
  options?: RequestFormFieldOption[];
  min?: number;
  max?: number;
  step?: number;
  pattern?: string;
  accept?: string;
  multiple?: boolean;
  repeatable?: boolean;
  repeatSeparator?: 'newline' | 'comma' | 'json-lines';
  group?: string;
  visibilityDependsOnFieldName?: string;
  visibilityOperator?: 'equals' | 'not-equals' | 'contains' | 'filled' | 'not-filled';
  visibilityValue?: string;
}

export interface RequestFormAuthRequirement {
  enabled: boolean;
  sourceRequestId?: string;
  tokenPath?: string;
  scheme?: 'Bearer' | 'Token' | 'Raw';
  headerName?: string;
}

export interface RequestFormResponseMapping {
  id: string;
  sourceRequestId: string;
  responsePath: string;
  targetFieldId: string;
}

export interface RequestFormScripts {
  beforeSubmit?: string;
  afterResponse?: string;
}

export interface RequestFormUiConfig {
  title?: string;
  subtitle?: string;
  submitLabel?: string;
  showReset?: boolean;
  resetLabel?: string;
  customStyle?: string;
  customScript?: string;
}

export interface RequestFormTemplate {
  id: string;
  name: string;
  fields: RequestFormField[];
  createdAt: number;
}

export interface RequestFormConfig {
  enabled: boolean;
  fields: RequestFormField[];
  authRequirement?: RequestFormAuthRequirement;
  responseMappings?: RequestFormResponseMapping[];
  scripts?: RequestFormScripts;
  templates?: RequestFormTemplate[];
  ui?: RequestFormUiConfig;
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
  method: HttpMethod;
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
  form: ShareSettings;
}

export interface ApiRequest {
  id: string;
  name: string;
  method: HttpMethod;
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
  formConfig?: RequestFormConfig;
  createdAt: string;
  updatedAt: string;
}

export interface CollectionFolder {
  id: string;
  name: string;
  requests: ApiRequest[];
  folders: CollectionFolder[];
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

export interface EnvVariable {
  id: string;
  key: string;
  value: string;
  initialValue?: string;
  enabled: boolean;
  secret?: boolean;
}

export interface Environment {
  id: string;
  name: string;
  variables: EnvVariable[];
  isActive: boolean;
  ownerUserId?: string;
  storageScope?: 'local' | 'remote';
  createdAt: string;
  updatedAt: string;
}

export interface ProxyResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  size: number;
  time: number;
  error?: string;
}

export interface RequestHistoryEntry {
  id: string;
  tabId: string;
  collectionId?: string;
  timestamp: string;
  request: ApiRequest;
  resolvedUrl: string;
  response: ProxyResponse;
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

export type RequestTab = 'params' | 'headers' | 'body' | 'auth' | 'pre-script' | 'test-script' | 'docs';
export type ResponseTab = 'body' | 'headers' | 'cookies' | 'timeline' | 'history';

export interface RequestState {
  request: ApiRequest;
  collectionId?: string;
  isDirty: boolean;
}

export interface AppTab {
  id: string;
  requestState: RequestState;
}

export type StorageMode = 'local' | 'remote';

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
    form: { access: VisibilityMode };
  };
  createdAt: string;
  updatedAt: string;
}
