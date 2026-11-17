begin;
create table rea.ai_budget(day date primary key,calls integer not null default 0 check(calls between 0 and 24),last_attempt timestamptz);
create table rea.ai_cache(singleton boolean primary key default true check(singleton),payload jsonb not null,at timestamptz not null default now());
alter table rea.ai_budget enable row level security;alter table rea.ai_cache enable row level security;
create policy service_only on rea.ai_budget for all to service_role using(true) with check(true);
create policy service_only on rea.ai_cache for all to service_role using(true) with check(true);
revoke all on rea.ai_budget,rea.ai_cache from public,anon,authenticated;
grant select,insert,update on rea.ai_budget,rea.ai_cache to service_role;
create function public.rea_advisory_claim() returns jsonb
language plpgsql security invoker set search_path='' as $$
declare token text;b rea.ai_budget%rowtype;c rea.ai_cache%rowtype;d date=(now() at time zone 'UTC')::date;begin
 select * into c from rea.ai_cache where singleton;
 if c.at>now()-interval '60 minutes' then return jsonb_build_object('allowed',false,'reason','CACHED','cached',c.payload);end if;
 select decrypted_secret into token from vault.decrypted_secrets where name='rea-ai-advisor-auth';
 if token is null then return jsonb_build_object('allowed',false,'reason','NOT_CONFIGURED');end if;
 insert into rea.ai_budget(day) values(d) on conflict do nothing;
 select * into b from rea.ai_budget where day=d for update;
 if b.calls>=24 or b.last_attempt>now()-interval '60 minutes' then return jsonb_build_object('allowed',false,'reason','BUDGET_OR_INTERVAL_LIMIT','cached',c.payload);end if;
 update rea.ai_budget set calls=calls+1,last_attempt=now() where day=d;
 return jsonb_build_object('allowed',true,'url','https://rea-bitkub-advisor.restartbykeita.workers.dev/analyze','token',token);
end$$;
create function public.rea_advisory_finish(p_advice jsonb) returns boolean
language plpgsql security invoker set search_path='' as $$begin
 if p_advice->>'mode'<>'PAPER_ONLY' or p_advice->>'canTrade'<>'false' or p_advice->>'canChangeLimits'<>'false' or p_advice->>'risk' not in('LOW','MEDIUM','HIGH','UNKNOWN') or char_length(p_advice->>'summary')>600 then raise exception 'INVALID_ADVISORY';end if;
 insert into rea.ai_cache values(true,p_advice,now()) on conflict(singleton) do update set payload=excluded.payload,at=excluded.at;return true;
end$$;
revoke all on function public.rea_advisory_claim(),public.rea_advisory_finish(jsonb) from public,anon,authenticated;
grant execute on function public.rea_advisory_claim(),public.rea_advisory_finish(jsonb) to service_role;
commit;
