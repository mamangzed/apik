import { randomBytes } from 'crypto';
import {
  ApiRequest,
  Collection,
  CollectionAccessRole,
  CollectionMember,
  CollectionMemberRole,
  CollectionSharing,
  Environment,
  PublicCollectionResponse,
  ShareSettings,
  VisibilityMode,
} from '../types';
import { getSupabaseAdmin } from '../lib/supabase';

type CollectionRow = {
  id: string;
  owner_user_id: string;
  name: string;
  description: string | null;
  document: Partial<Collection> | null;
  collection_access: VisibilityMode;
  collection_share_token: string | null;
  docs_access: VisibilityMode;
  docs_share_token: string | null;
  form_access: VisibilityMode;
  form_share_token: string | null;
  created_at: string;
  updated_at: string;
};

type EnvironmentRow = {
  id: string;
  owner_user_id: string;
  name: string;
  is_active: boolean;
  document: Partial<Environment> | null;
  created_at: string;
  updated_at: string;
};

type CollectionMemberRow = {
  collection_id: string;
  user_id: string;
  role: CollectionMemberRole;
  invited_by_user_id: string;
  created_at: string;
  updated_at: string;
};

function defaultShareSettings(): ShareSettings {
  return { access: 'private', token: null };
}

function defaultSharing(): CollectionSharing {
  return {
    collection: defaultShareSettings(),
    docs: defaultShareSettings(),
    form: defaultShareSettings(),
  };
}

export function normalizeSharing(sharing?: Partial<CollectionSharing>): CollectionSharing {
  return {
    collection: {
      access: sharing?.collection?.access ?? 'private',
      token: sharing?.collection?.token ?? null,
    },
    docs: {
      access: sharing?.docs?.access ?? 'private',
      token: sharing?.docs?.token ?? null,
    },
    form: {
      access: sharing?.form?.access ?? 'private',
      token: sharing?.form?.token ?? null,
    },
  };
}

export function normalizeCollection(input: Partial<Collection>): Collection {
  const now = new Date().toISOString();
  return {
    id: input.id || '',
    name: input.name || 'New Collection',
    description: input.description || '',
    requests: input.requests || [],
    folders: input.folders || [],
    variables: input.variables || [],
    sharing: normalizeSharing(input.sharing),
    collaborators: input.collaborators || [],
    runReports: input.runReports || [],
    auditLog: input.auditLog || [],
    currentUserRole: input.currentUserRole,
    ownerUserId: input.ownerUserId,
    storageScope: input.storageScope ?? 'remote',
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || now,
  };
}

export function normalizeEnvironment(input: Partial<Environment>): Environment {
  const now = new Date().toISOString();
  return {
    id: input.id || '',
    name: input.name || 'New Environment',
    variables: input.variables || [],
    isActive: input.isActive ?? false,
    ownerUserId: input.ownerUserId,
    storageScope: input.storageScope ?? 'remote',
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || now,
  };
}

function mapCollectionMemberRow(row: CollectionMemberRow): CollectionMember {
  return {
    userId: row.user_id,
    role: row.role,
    invitedBy: row.invited_by_user_id,
    createdAt: row.created_at,
  };
}

function mapCollectionRow(
  row: CollectionRow,
  options?: { currentUserRole?: CollectionAccessRole; collaborators?: CollectionMember[] },
): Collection {
  const document = normalizeCollection(row.document || {});
  return {
    ...document,
    id: row.id,
    name: row.name || document.name,
    description: row.description || document.description || '',
    sharing: {
      collection: {
        access: row.collection_access || document.sharing.collection.access,
        token: row.collection_share_token,
      },
      docs: {
        access: row.docs_access || document.sharing.docs.access,
        token: row.docs_share_token,
      },
      form: {
        access: row.form_access || document.sharing.form.access,
        token: row.form_share_token,
      },
    },
    collaborators: options?.collaborators ?? document.collaborators ?? [],
    currentUserRole: options?.currentUserRole ?? document.currentUserRole,
    ownerUserId: row.owner_user_id,
    storageScope: 'remote',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapEnvironmentRow(row: EnvironmentRow): Environment {
  const document = normalizeEnvironment(row.document || {});
  return {
    ...document,
    id: row.id,
    name: row.name || document.name,
    isActive: row.is_active,
    ownerUserId: row.owner_user_id,
    storageScope: 'remote',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toCollectionRow(ownerUserId: string, collection: Collection) {
  return {
    id: collection.id,
    owner_user_id: ownerUserId,
    name: collection.name,
    description: collection.description || '',
    document: {
      ...collection,
      ownerUserId,
      storageScope: 'remote',
    },
    collection_access: collection.sharing.collection.access,
    collection_share_token: collection.sharing.collection.token,
    docs_access: collection.sharing.docs.access,
    docs_share_token: collection.sharing.docs.token,
    form_access: collection.sharing.form.access,
    form_share_token: collection.sharing.form.token,
    updated_at: collection.updatedAt,
  };
}

function toEnvironmentRow(userId: string, environment: Environment) {
  return {
    id: environment.id,
    owner_user_id: userId,
    name: environment.name,
    is_active: environment.isActive,
    document: {
      ...environment,
      ownerUserId: userId,
      storageScope: 'remote',
    },
    updated_at: environment.updatedAt,
  };
}

function createShareToken(): string {
  return randomBytes(16).toString('hex');
}

export async function getCollection(userId: string, collectionId: string): Promise<Collection | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('apix_collections')
    .select('*')
    .eq('owner_user_id', userId)
    .eq('id', collectionId)
    .maybeSingle();

  if (error) throw error;
  return data ? mapCollectionRow(data as CollectionRow, { currentUserRole: 'owner' }) : null;
}

export async function getCollectionAccess(
  userId: string,
  collectionId: string,
): Promise<{ collection: Collection; role: CollectionAccessRole } | null> {
  const supabase = getSupabaseAdmin();
  const { data: collectionData, error: collectionError } = await supabase
    .from('apix_collections')
    .select('*')
    .eq('id', collectionId)
    .maybeSingle();

  if (collectionError) throw collectionError;
  if (!collectionData) return null;

  const collectionRow = collectionData as CollectionRow;
  if (collectionRow.owner_user_id === userId) {
    const collaborators = (await listCollectionMembers(userId, collectionId, true)) || [];
    return {
      collection: mapCollectionRow(collectionRow, { currentUserRole: 'owner', collaborators }),
      role: 'owner',
    };
  }

  const { data: memberData, error: memberError } = await supabase
    .from('apix_collection_members')
    .select('*')
    .eq('collection_id', collectionId)
    .eq('user_id', userId)
    .maybeSingle();

  if (memberError) throw memberError;
  if (!memberData) return null;

  const member = memberData as CollectionMemberRow;
  return {
    collection: mapCollectionRow(collectionRow, { currentUserRole: member.role }),
    role: member.role,
  };
}

export async function listCollections(userId: string): Promise<Collection[]> {
  const supabase = getSupabaseAdmin();

  const { data: ownedData, error: ownedError } = await supabase
    .from('apix_collections')
    .select('*')
    .eq('owner_user_id', userId)
    .order('updated_at', { ascending: false });
  if (ownedError) throw ownedError;

  const { data: memberData, error: memberError } = await supabase
    .from('apix_collection_members')
    .select('*')
    .eq('user_id', userId);
  if (memberError) throw memberError;

  const memberRows = (memberData || []) as CollectionMemberRow[];
  const memberRolesByCollection = new Map<string, CollectionMemberRole>();
  for (const row of memberRows) {
    memberRolesByCollection.set(row.collection_id, row.role);
  }

  const memberCollectionIds = Array.from(new Set(memberRows.map((row) => row.collection_id)));
  let memberCollections: CollectionRow[] = [];
  if (memberCollectionIds.length > 0) {
    const { data: memberCollectionsData, error: memberCollectionsError } = await supabase
      .from('apix_collections')
      .select('*')
      .in('id', memberCollectionIds)
      .order('updated_at', { ascending: false });

    if (memberCollectionsError) throw memberCollectionsError;
    memberCollections = (memberCollectionsData || []) as CollectionRow[];
  }

  const merged = new Map<string, Collection>();
  for (const row of (ownedData || []) as CollectionRow[]) {
    merged.set(row.id, mapCollectionRow(row, { currentUserRole: 'owner' }));
  }

  for (const row of memberCollections) {
    if (!merged.has(row.id)) {
      merged.set(
        row.id,
        mapCollectionRow(row, {
          currentUserRole: memberRolesByCollection.get(row.id) || 'viewer',
        }),
      );
    }
  }

  return Array.from(merged.values()).sort((a, b) =>
    new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
}

export async function upsertCollection(ownerUserId: string, collection: Collection): Promise<Collection> {
  const supabase = getSupabaseAdmin();
  const payload = toCollectionRow(ownerUserId, normalizeCollection(collection));
  const { data, error } = await supabase
    .from('apix_collections')
    .upsert(payload, { onConflict: 'id' })
    .select('*')
    .single();

  if (error) throw error;
  return mapCollectionRow(data as CollectionRow, { currentUserRole: 'owner' });
}

export async function deleteCollection(userId: string, collectionId: string): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  const { error, count } = await supabase
    .from('apix_collections')
    .delete({ count: 'exact' })
    .eq('owner_user_id', userId)
    .eq('id', collectionId);

  if (error) throw error;
  return Boolean(count);
}

export async function setCollectionShareAccess(
  userId: string,
  collectionId: string,
  target: 'collection' | 'docs' | 'form',
  access: VisibilityMode,
): Promise<Collection | null> {
  const collection = await getCollection(userId, collectionId);
  if (!collection) return null;

  const current = normalizeSharing(collection.sharing);
  const nextToken = current[target].token || createShareToken();
  const nextSharing: CollectionSharing = {
    ...current,
    [target]: {
      access,
      token: access === 'public' ? nextToken : current[target].token,
    },
  };

  return upsertCollection(userId, {
    ...collection,
    sharing: nextSharing,
    updatedAt: new Date().toISOString(),
  });
}

export async function listCollectionMembers(
  actorUserId: string,
  collectionId: string,
  skipAccessCheck = false,
): Promise<CollectionMember[] | null> {
  if (!skipAccessCheck) {
    const access = await getCollectionAccess(actorUserId, collectionId);
    if (!access) return null;
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('apix_collection_members')
    .select('*')
    .eq('collection_id', collectionId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return ((data || []) as CollectionMemberRow[]).map(mapCollectionMemberRow);
}

export async function upsertCollectionMember(
  ownerUserId: string,
  collectionId: string,
  memberUserId: string,
  role: CollectionMemberRole,
): Promise<CollectionMember[] | null> {
  const collection = await getCollection(ownerUserId, collectionId);
  if (!collection) return null;

  if (memberUserId === ownerUserId) {
    throw new Error('Owner already has full access');
  }

  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from('apix_collection_members')
    .upsert(
      {
        collection_id: collectionId,
        user_id: memberUserId,
        role,
        invited_by_user_id: ownerUserId,
      },
      { onConflict: 'collection_id,user_id' },
    );

  if (error) throw error;
  return listCollectionMembers(ownerUserId, collectionId, true);
}

export async function removeCollectionMember(
  ownerUserId: string,
  collectionId: string,
  memberUserId: string,
): Promise<CollectionMember[] | null> {
  const collection = await getCollection(ownerUserId, collectionId);
  if (!collection) return null;

  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from('apix_collection_members')
    .delete()
    .eq('collection_id', collectionId)
    .eq('user_id', memberUserId);

  if (error) throw error;
  return listCollectionMembers(ownerUserId, collectionId, true);
}

export async function syncCollections(userId: string, collections: Collection[]): Promise<void> {
  if (collections.length === 0) return;

  const supabase = getSupabaseAdmin();
  const normalized = collections
    .map((collection) => ({
      ...normalizeCollection(collection),
      ownerUserId: userId,
      storageScope: 'remote' as const,
    }))
    .filter((collection) => Boolean(collection.id));

  if (normalized.length === 0) return;

  const ids = normalized.map((collection) => collection.id);
  const { data, error } = await supabase
    .from('apix_collections')
    .select('id,updated_at')
    .eq('owner_user_id', userId)
    .in('id', ids);

  if (error) throw error;

  const remoteUpdatedById = new Map<string, number>();
  for (const row of (data || []) as Array<{ id: string; updated_at: string }>) {
    remoteUpdatedById.set(row.id, new Date(row.updated_at).getTime());
  }

  for (const collection of normalized) {
    const localUpdatedAt = new Date(collection.updatedAt).getTime();
    const remoteUpdatedAt = remoteUpdatedById.get(collection.id);
    if (remoteUpdatedAt && localUpdatedAt <= remoteUpdatedAt) {
      continue;
    }

    await upsertCollection(userId, {
      ...collection,
    });
  }
}

export async function listEnvironments(userId: string): Promise<Environment[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('apix_environments')
    .select('*')
    .eq('owner_user_id', userId)
    .order('updated_at', { ascending: false });

  if (error) throw error;
  return ((data || []) as EnvironmentRow[]).map(mapEnvironmentRow);
}

export async function getEnvironment(userId: string, environmentId: string): Promise<Environment | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('apix_environments')
    .select('*')
    .eq('owner_user_id', userId)
    .eq('id', environmentId)
    .maybeSingle();

  if (error) throw error;
  return data ? mapEnvironmentRow(data as EnvironmentRow) : null;
}

async function clearActiveEnvironments(userId: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from('apix_environments')
    .update({ is_active: false })
    .eq('owner_user_id', userId)
    .eq('is_active', true);

  if (error) throw error;
}

export async function upsertEnvironment(userId: string, environment: Environment): Promise<Environment> {
  const normalized = normalizeEnvironment(environment);
  if (normalized.isActive) {
    await clearActiveEnvironments(userId);
  }

  const supabase = getSupabaseAdmin();
  const payload = toEnvironmentRow(userId, normalized);
  const { data, error } = await supabase
    .from('apix_environments')
    .upsert(payload, { onConflict: 'id' })
    .select('*')
    .single();

  if (error) throw error;
  return mapEnvironmentRow(data as EnvironmentRow);
}

export async function deleteEnvironment(userId: string, environmentId: string): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  const { error, count } = await supabase
    .from('apix_environments')
    .delete({ count: 'exact' })
    .eq('owner_user_id', userId)
    .eq('id', environmentId);

  if (error) throw error;
  return Boolean(count);
}

export async function syncEnvironments(userId: string, environments: Environment[]): Promise<void> {
  if (environments.length === 0) return;

  const supabase = getSupabaseAdmin();
  const normalizedList = environments
    .map((environment) => ({
      ...normalizeEnvironment(environment),
      ownerUserId: userId,
      storageScope: 'remote' as const,
    }))
    .filter((environment) => Boolean(environment.id));

  if (normalizedList.length === 0) return;

  const ids = normalizedList.map((environment) => environment.id);
  const { data, error } = await supabase
    .from('apix_environments')
    .select('id,updated_at')
    .eq('owner_user_id', userId)
    .in('id', ids);

  if (error) throw error;

  const remoteUpdatedById = new Map<string, number>();
  for (const row of (data || []) as Array<{ id: string; updated_at: string }>) {
    remoteUpdatedById.set(row.id, new Date(row.updated_at).getTime());
  }

  let activeHandled = false;
  for (const normalized of normalizedList) {
    const localUpdatedAt = new Date(normalized.updatedAt).getTime();
    const remoteUpdatedAt = remoteUpdatedById.get(normalized.id);
    if (remoteUpdatedAt && localUpdatedAt <= remoteUpdatedAt) {
      continue;
    }

    if (normalized.isActive && !activeHandled) {
      await clearActiveEnvironments(userId);
      activeHandled = true;
    }
    await upsertEnvironment(userId, {
      ...normalized,
      isActive: normalized.isActive && activeHandled,
    });
  }
}

function toPublicCollection(collection: Collection): PublicCollectionResponse {
  return {
    id: collection.id,
    name: collection.name,
    description: collection.description,
    requests: collection.requests,
    folders: collection.folders,
    variables: collection.variables,
    sharing: {
      collection: { access: collection.sharing.collection.access },
      docs: { access: collection.sharing.docs.access },
      form: { access: collection.sharing.form.access },
    },
    createdAt: collection.createdAt,
    updatedAt: collection.updatedAt,
  };
}

export async function getPublicCollectionByToken(token: string): Promise<PublicCollectionResponse | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('apix_collections')
    .select('*')
    .eq('collection_share_token', token)
    .eq('collection_access', 'public')
    .maybeSingle();

  if (error) throw error;
  return data ? toPublicCollection(mapCollectionRow(data as CollectionRow)) : null;
}

export async function getPublicDocsByToken(token: string): Promise<PublicCollectionResponse | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('apix_collections')
    .select('*')
    .eq('docs_share_token', token)
    .eq('docs_access', 'public')
    .maybeSingle();

  if (error) throw error;
  return data ? toPublicCollection(mapCollectionRow(data as CollectionRow)) : null;
}

export async function getPublicFormByToken(token: string): Promise<PublicCollectionResponse | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('apix_collections')
    .select('*')
    .eq('form_share_token', token)
    .eq('form_access', 'public')
    .maybeSingle();

  if (error) throw error;
  return data ? toPublicCollection(mapCollectionRow(data as CollectionRow)) : null;
}
