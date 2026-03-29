import { Collection, CollectionSharing, Environment } from '../types';

const COLLECTIONS_KEY = 'apik.local.collections';
const ENVIRONMENTS_KEY = 'apik.local.environments';

function defaultSharing(): CollectionSharing {
  return {
    collection: { access: 'private', token: null },
    docs: { access: 'private', token: null },
    form: { access: 'private', token: null },
  };
}

function normalizeCollection(collection: Collection): Collection {
  const sharing = collection.sharing || ({} as CollectionSharing);
  return {
    ...collection,
    sharing: {
      collection: sharing.collection || defaultSharing().collection,
      docs: sharing.docs || defaultSharing().docs,
      form: sharing.form || defaultSharing().form,
    },
    storageScope: 'local',
  };
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, value: T): void {
  localStorage.setItem(key, JSON.stringify(value));
}

export function getLocalCollections(): Collection[] {
  return readJson<Collection[]>(COLLECTIONS_KEY, []).map(normalizeCollection);
}

export function saveLocalCollections(collections: Collection[]): void {
  writeJson(COLLECTIONS_KEY, collections.map(normalizeCollection));
}

export function getLocalEnvironments(): Environment[] {
  return readJson<Environment[]>(ENVIRONMENTS_KEY, []).map((environment) => ({
    ...environment,
    storageScope: 'local',
  }));
}

export function saveLocalEnvironments(environments: Environment[]): void {
  writeJson(
    ENVIRONMENTS_KEY,
    environments.map((environment) => ({
      ...environment,
      storageScope: 'local',
    })),
  );
}

export function clearLocalCollections(): void {
  localStorage.removeItem(COLLECTIONS_KEY);
}

export function clearLocalEnvironments(): void {
  localStorage.removeItem(ENVIRONMENTS_KEY);
}

export function clearLocalData(): void {
  clearLocalCollections();
  clearLocalEnvironments();
}