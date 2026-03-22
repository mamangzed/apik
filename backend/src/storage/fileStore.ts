import fs from 'fs-extra';
import path from 'path';
import { Collection, Environment } from '../types';

const DATA_DIR = path.join(__dirname, '../../data');
const COLLECTIONS_FILE = path.join(DATA_DIR, 'collections.json');
const ENVIRONMENTS_FILE = path.join(DATA_DIR, 'environments.json');

let collectionsCache: Collection[] = [];
let environmentsCache: Environment[] = [];

// Serialize file writes to avoid disk contention under burst updates.
let collectionsWriteQueue: Promise<void> = Promise.resolve();
let environmentsWriteQueue: Promise<void> = Promise.resolve();

export async function initStorage(): Promise<void> {
  await fs.ensureDir(DATA_DIR);
  if (!(await fs.pathExists(COLLECTIONS_FILE))) {
    await fs.writeJson(COLLECTIONS_FILE, []);
  }
  if (!(await fs.pathExists(ENVIRONMENTS_FILE))) {
    await fs.writeJson(ENVIRONMENTS_FILE, []);
  }

  // Warm caches once on startup.
  try {
    collectionsCache = await fs.readJson(COLLECTIONS_FILE);
  } catch {
    collectionsCache = [];
  }

  try {
    environmentsCache = await fs.readJson(ENVIRONMENTS_FILE);
  } catch {
    environmentsCache = [];
  }
}

export async function getCollections(): Promise<Collection[]> {
  return collectionsCache;
}

export async function saveCollections(collections: Collection[]): Promise<void> {
  collectionsCache = collections;
  collectionsWriteQueue = collectionsWriteQueue.then(() => fs.writeJson(COLLECTIONS_FILE, collectionsCache));
  await collectionsWriteQueue;
}

export async function getEnvironments(): Promise<Environment[]> {
  return environmentsCache;
}

export async function saveEnvironments(environments: Environment[]): Promise<void> {
  environmentsCache = environments;
  environmentsWriteQueue = environmentsWriteQueue.then(() => fs.writeJson(ENVIRONMENTS_FILE, environmentsCache));
  await environmentsWriteQueue;
}
