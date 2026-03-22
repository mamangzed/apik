create extension if not exists pgcrypto;

create table if not exists public.apix_collections (
  id text primary key,
  owner_user_id text not null,
  name text not null,
  description text,
  document jsonb not null default '{}'::jsonb,
  collection_access text not null default 'private' check (collection_access in ('private', 'public')),
  collection_share_token text unique,
  docs_access text not null default 'private' check (docs_access in ('private', 'public')),
  docs_share_token text unique,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists apix_collections_owner_idx on public.apix_collections (owner_user_id, updated_at desc);
create index if not exists apix_collections_public_idx on public.apix_collections (collection_share_token, docs_share_token);

create table if not exists public.apix_collection_members (
  collection_id text not null references public.apix_collections(id) on delete cascade,
  user_id text not null,
  role text not null check (role in ('editor', 'viewer')),
  invited_by_user_id text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (collection_id, user_id)
);

create index if not exists apix_collection_members_user_idx on public.apix_collection_members (user_id);
create index if not exists apix_collection_members_collection_idx on public.apix_collection_members (collection_id);

create table if not exists public.apix_environments (
  id text primary key,
  owner_user_id text not null,
  name text not null,
  is_active boolean not null default false,
  document jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists apix_environments_owner_idx on public.apix_environments (owner_user_id, updated_at desc);

create or replace function public.apix_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists apix_collections_touch_updated_at on public.apix_collections;
create trigger apix_collections_touch_updated_at
before update on public.apix_collections
for each row
execute function public.apix_touch_updated_at();

drop trigger if exists apix_environments_touch_updated_at on public.apix_environments;
create trigger apix_environments_touch_updated_at
before update on public.apix_environments
for each row
execute function public.apix_touch_updated_at();

drop trigger if exists apix_collection_members_touch_updated_at on public.apix_collection_members;
create trigger apix_collection_members_touch_updated_at
before update on public.apix_collection_members
for each row
execute function public.apix_touch_updated_at();