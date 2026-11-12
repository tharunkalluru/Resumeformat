-- Free-try records hold a salted hash of the visitor's address. They are only needed for a day,
-- so a daily job deletes anything older than two days (the function also does this on each request).
create extension if not exists pg_cron;
select cron.schedule('folio-purge-anon-runs', '17 3 * * *', $$delete from public.ai_anon_runs where created_at < now() - interval '2 days'$$);
