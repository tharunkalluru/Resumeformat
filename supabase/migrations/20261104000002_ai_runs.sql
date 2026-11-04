-- AI tailoring run log: one row per request, used for per-user and global daily limits
-- and as a replay guard (request_id is unique). Written only by the ai edge function.
create table public.ai_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  request_id text not null unique,
  model text not null,
  status text not null default 'started' check (status in ('started', 'succeeded', 'failed')),
  input_tokens integer,
  output_tokens integer,
  error_code text,
  created_at timestamptz not null default now()
);
create index ai_runs_user_created_idx on public.ai_runs (user_id, created_at);
create index ai_runs_created_idx on public.ai_runs (created_at);
alter table public.ai_runs enable row level security;
create policy "Users read their AI runs" on public.ai_runs for select to authenticated
  using (user_id = (select auth.uid()));
revoke insert, update, delete on public.ai_runs from anon, authenticated;
