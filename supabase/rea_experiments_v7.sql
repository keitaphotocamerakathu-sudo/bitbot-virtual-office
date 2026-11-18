-- Isolated forward Paper trials, committed atomically with the existing Paper lease.
-- Does not alter Live permissions, capital, orders, execution locks or schedules.
begin;
create table rea.experiment_books(
 user_id uuid primary key references rea.bot_settings(user_id),
 last_at bigint not null check(last_at>0),
 book jsonb not null check(jsonb_typeof(book)='object' and book->>'mode' is not distinct from 'PAPER_ONLY' and book->>'protocol' is not distinct from 'REA-EXPERIMENT-24.0.0' and octet_length(book::text)<=1048576),
 updated_at timestamptz not null default now()
);
alter table rea.experiment_books enable row level security;
create policy service_only on rea.experiment_books for all to service_role using(true) with check(true);
revoke all on rea.experiment_books from public,anon,authenticated,service_role;
grant select,insert,update on rea.experiment_books to service_role;

create function public.rea_experiment_state(p_uid uuid) returns jsonb
language sql security invoker set search_path='' as $$
 select book from rea.experiment_books where user_id=p_uid;
$$;
create function public.rea_experiment_checkpoint(
 p_uid uuid,p_lease uuid,p_revision bigint,p_state jsonb,p_latest jsonb,p_events jsonb,p_signals jsonb,p_fills jsonb,p_at bigint,p_book jsonb,p_error text default null
) returns boolean language plpgsql security invoker set search_path='' as $$
declare saved boolean;account_keys text[];a jsonb;
begin
 if p_book->>'mode' is distinct from 'PAPER_ONLY' or p_book->>'protocol' is distinct from 'REA-EXPERIMENT-24.0.0' or jsonb_typeof(p_book->'accounts') is distinct from 'object' or octet_length(p_book::text)>1048576 then raise exception 'INVALID_PAPER_EXPERIMENT_PROTOCOL';end if;
 if p_book->>'lastAt' is distinct from p_at::text or p_latest->'experiments'->>'at' is distinct from p_at::text or p_latest->'experiments'->>'protocol' is distinct from 'REA-EXPERIMENT-24.0.0' or p_latest->'experiments'->>'mode' is distinct from 'PAPER_ONLY' then raise exception 'EXPERIMENT_SNAPSHOT_MISMATCH';end if;
 select array_agg(key order by key) into account_keys from jsonb_object_keys(p_book->'accounts') as k(key);
 if account_keys is distinct from array['BREAKOUT','CAUTIOUS_MIXED','MEAN_REVERSION','MIXED','TREND'] then raise exception 'INVALID_PAPER_EXPERIMENT_ACCOUNTS';end if;
 for a in select value->'state' from jsonb_each(p_book->'accounts') loop
  if a->>'mode' is distinct from 'PAPER_ONLY' or a->>'initialCapital' is distinct from '10000' or (a->>'cash')::numeric<0 or a->>'lastAt' is distinct from p_at::text then raise exception 'INVALID_PAPER_EXPERIMENT_STATE';end if;
  if (select count(distinct symbol) from (select p->>'symbol' as symbol from jsonb_array_elements(a->'positions')p union all select o->>'symbol' from jsonb_array_elements(a->'orders')o where o->>'side'='BUY' and o->>'status' in('OPEN','PARTIAL'))q)>2 then raise exception 'EXPERIMENT_POSITION_LIMIT';end if;
 end loop;
 -- The parent verifies owner, lease, revision and Paper-only financial limits.
 saved=public.rea_checkpoint(p_uid,p_lease,p_revision,p_state,p_latest,p_events,p_signals,p_fills,p_at,p_error);
 if not saved then return false;end if;
 insert into rea.experiment_books(user_id,last_at,book) values(p_uid,p_at,p_book)
 on conflict(user_id) do update set last_at=excluded.last_at,book=excluded.book,updated_at=now()
 where rea.experiment_books.last_at<=excluded.last_at;
 if not found then raise exception 'EXPERIMENT_CLOCK_REGRESSION';end if;
 return true;
end$$;
revoke all on function public.rea_experiment_state(uuid),public.rea_experiment_checkpoint(uuid,uuid,bigint,jsonb,jsonb,jsonb,jsonb,jsonb,bigint,jsonb,text) from public,anon,authenticated;
grant execute on function public.rea_experiment_state(uuid),public.rea_experiment_checkpoint(uuid,uuid,bigint,jsonb,jsonb,jsonb,jsonb,jsonb,bigint,jsonb,text) to service_role;

-- Accept the previous 7/8-reviewer receipts during rolling deployment, plus 9 now.
create or replace function rea.archive_review_cycle() returns trigger
language plpgsql security invoker set search_path='' as $$
declare receipt jsonb;stamp text;scope text;
begin
 receipt=new.latest->'team';
 if tg_op='UPDATE' and receipt is not distinct from old.latest->'team' then return new;end if;
 if receipt is null or jsonb_typeof(receipt)<>'object' or octet_length(receipt::text)>65536 then return new;end if;
 if receipt->>'method' is distinct from 'DETERMINISTIC_SHARED_SNAPSHOT' or coalesce(receipt->>'reviewers','') not in('7','8','9') then return new;end if;
 if jsonb_typeof(receipt->'reviews') is distinct from 'array' then return new;end if;
 if jsonb_array_length(receipt->'reviews')<>(receipt->>'reviewers')::integer then return new;end if;
 stamp=receipt->>'at';
 if jsonb_typeof(receipt->'at') is distinct from 'number' or stamp is null or stamp!~'^[1-9][0-9]{0,14}$' then return new;end if;
 scope=case when tg_table_name='live_accounts' then 'LIVE' else 'PAPER' end;
 insert into rea.review_cycles(user_id,mode,at_ms,payload) values(new.user_id,scope,stamp::bigint,receipt)
 on conflict(user_id,mode,at_ms) do nothing;
 return new;
end$$;
notify pgrst,'reload schema';
commit;
