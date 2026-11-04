-- Folio foundation schema. Applied identically to every regional database
-- (India: ap-south-1, US: us-east-2). Each user's data lives in one home region.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

-- Accounts own all data (spec: Platform foundations, tenancy).
create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'personal' check (kind in ('personal', 'org')),
  name text not null default '',
  plan text not null default 'free',
  home_region text not null check (home_region in ('in', 'us')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.account_members (
  account_id uuid not null references public.accounts (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  primary key (account_id, user_id)
);
create index account_members_user_idx on public.account_members (user_id);

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  avatar_url text,
  locale text not null default 'en-US',
  default_account_id uuid references public.accounts (id) on delete set null,
  default_template text not null default 'classic',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.resumes (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  title text not null default 'My resume',
  is_base boolean not null default true,
  data jsonb not null default '{}'::jsonb,
  schema_version integer not null default 1,
  source_file_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index resumes_account_idx on public.resumes (account_id);

create table public.applications (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  resume_id uuid references public.resumes (id) on delete set null,
  company text not null default '',
  role text not null default '',
  job_description text not null default '',
  job_url text,
  status text not null default 'draft' check (status in ('draft', 'applied', 'interviewing', 'offer', 'rejected', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index applications_account_idx on public.applications (account_id);
create index applications_resume_idx on public.applications (resume_id);

create table public.application_versions (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications (id) on delete cascade,
  account_id uuid not null references public.accounts (id) on delete cascade,
  resume_data jsonb not null,
  schema_version integer not null default 1,
  coverage jsonb,
  template text not null default 'classic',
  created_at timestamptz not null default now()
);
create index application_versions_application_idx on public.application_versions (application_id);
create index application_versions_account_idx on public.application_versions (account_id);

-- Helpers live in the private schema, which the Data API does not expose.
create or replace function private.is_account_member(target uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.account_members m where m.account_id = target and m.user_id = (select auth.uid()));
$$;
create or replace function private.is_account_owner(target uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.account_members m where m.account_id = target and m.user_id = (select auth.uid()) and m.role = 'owner');
$$;
-- Storage paths start with the account id; compare as text so a malformed path is denied, not an error.
create or replace function private.is_account_folder_member(folder text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.account_members m where m.account_id::text = folder and m.user_id = (select auth.uid()));
$$;
revoke all on function private.is_account_member(uuid), private.is_account_owner(uuid), private.is_account_folder_member(text) from public, anon;
grant execute on function private.is_account_member(uuid), private.is_account_owner(uuid), private.is_account_folder_member(text) to authenticated;

create or replace function private.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end;
$$;
create trigger accounts_updated_at before update on public.accounts for each row execute function private.set_updated_at();
create trigger profiles_updated_at before update on public.profiles for each row execute function private.set_updated_at();
create trigger resumes_updated_at before update on public.resumes for each row execute function private.set_updated_at();
create trigger applications_updated_at before update on public.applications for each row execute function private.set_updated_at();

-- Which region this database serves; set once per project after this migration.
create table private.settings (key text primary key, value text not null);

-- Every new user (email or Google) gets a personal account in this region and a profile.
create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  new_account uuid;
  display_name text := coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', '');
  region text := (select value from private.settings where key = 'home_region');
begin
  insert into public.accounts (kind, name, home_region) values ('personal', display_name, region) returning id into new_account;
  insert into public.account_members (account_id, user_id, role) values (new_account, new.id, 'owner');
  insert into public.profiles (user_id, full_name, avatar_url, default_account_id)
  values (new.id, display_name, new.raw_user_meta_data ->> 'avatar_url', new_account);
  return new;
end;
$$;
revoke all on function private.handle_new_user() from public, anon, authenticated;
create trigger on_auth_user_created after insert on auth.users for each row execute function private.handle_new_user();

alter table public.accounts enable row level security;
alter table public.account_members enable row level security;
alter table public.profiles enable row level security;
alter table public.resumes enable row level security;
alter table public.applications enable row level security;
alter table public.application_versions enable row level security;

create policy "Members read their accounts" on public.accounts for select to authenticated
  using (private.is_account_member(id));
create policy "Owners update their accounts" on public.accounts for update to authenticated
  using (private.is_account_owner(id)) with check (private.is_account_owner(id));

create policy "Users read their memberships" on public.account_members for select to authenticated
  using (user_id = (select auth.uid()));

create policy "Users read their profile" on public.profiles for select to authenticated
  using (user_id = (select auth.uid()));
create policy "Users update their profile" on public.profiles for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and (default_account_id is null or private.is_account_member(default_account_id)));

create policy "Members manage resumes" on public.resumes for all to authenticated
  using (private.is_account_member(account_id)) with check (private.is_account_member(account_id));
create policy "Members manage applications" on public.applications for all to authenticated
  using (private.is_account_member(account_id)) with check (private.is_account_member(account_id));
-- Versions are immutable snapshots: read and insert only.
create policy "Members read versions" on public.application_versions for select to authenticated
  using (private.is_account_member(account_id));
create policy "Members add versions" on public.application_versions for insert to authenticated
  with check (private.is_account_member(account_id)
    and exists (select 1 from public.applications a where a.id = application_id and a.account_id = application_versions.account_id));

-- Private file storage: objects live under <account_id>/...
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('originals', 'originals', false, 10485760, array['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']),
  ('exports', 'exports', false, 10485760, array['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do nothing;

create policy "Members read account files" on storage.objects for select to authenticated
  using (bucket_id in ('originals', 'exports') and private.is_account_folder_member((storage.foldername(name))[1]));
create policy "Members upload account files" on storage.objects for insert to authenticated
  with check (bucket_id in ('originals', 'exports') and private.is_account_folder_member((storage.foldername(name))[1]));
create policy "Members delete account files" on storage.objects for delete to authenticated
  using (bucket_id in ('originals', 'exports') and private.is_account_folder_member((storage.foldername(name))[1]));

create index profiles_default_account_idx on public.profiles (default_account_id);

-- Per-region setting (run once per project; not part of the shared schema):
--   India: insert into private.settings (key, value) values ('home_region', 'in');
--   US:    insert into private.settings (key, value) values ('home_region', 'us');

-- Column privileges: users may rename their account; plan, kind and home_region are system-set.
revoke update on public.accounts from anon, authenticated;
grant update (name) on public.accounts to authenticated;
revoke update on public.profiles from anon, authenticated;
grant update (full_name, avatar_url, locale, default_account_id, default_template) on public.profiles to authenticated;
