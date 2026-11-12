-- Free tries without an account: one row per call, keyed by a salted hash of the visitor's
-- address (never the address itself). Written and read only by the resume-ai edge function.
create table public.ai_anon_runs (
  id uuid primary key default gen_random_uuid(),
  ip_hash text not null,
  route text not null check (route in ('structure', 'tailor', 'job')),
  created_at timestamptz not null default now()
);
create index ai_anon_runs_lookup_idx on public.ai_anon_runs (ip_hash, route, created_at);
create index ai_anon_runs_created_idx on public.ai_anon_runs (created_at);
alter table public.ai_anon_runs enable row level security;
revoke all on public.ai_anon_runs from anon, authenticated;
