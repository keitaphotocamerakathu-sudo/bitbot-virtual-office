-- Post-trade knowledge and forward Paper experience. No activation, allocation or credential changes.
begin;
create table rea.trade_lessons(
 user_id uuid not null references rea.live_accounts(user_id),
 position_id uuid not null,
 closed_at_ms bigint not null check(closed_at_ms>0),
 payload jsonb not null check(jsonb_typeof(payload)='object' and payload->>'protocol' is not distinct from 'REA-LEARNING-25.0.0' and payload->>'mode' is not distinct from 'LIVE' and payload->>'simulation' is not distinct from 'false' and octet_length(payload::text)<=32768),
 created_at timestamptz not null default now(),
 primary key(user_id,position_id),
 foreign key(user_id,position_id) references rea.live_orders(user_id,client_order_id)
);
alter table rea.trade_lessons enable row level security;
create policy service_select on rea.trade_lessons for select to service_role using(true);
create policy service_insert on rea.trade_lessons for insert to service_role with check(true);
revoke all on rea.trade_lessons from public,anon,authenticated,service_role;
grant select,insert on rea.trade_lessons to service_role;

create function rea.archive_trade_lessons() returns trigger
language plpgsql security invoker set search_path='' as $$
declare reports jsonb;r jsonb;c jsonb;
begin
 reports=new.latest->'learning'->'reports';
 if tg_op='UPDATE' and reports is not distinct from old.latest->'learning'->'reports' then return new;end if;
 if new.state->>'mode' is distinct from 'LIVE' or new.latest->'learning'->>'protocol' is distinct from 'REA-LEARNING-25.0.0' or jsonb_typeof(reports) is distinct from 'array' then return new;end if;
 if jsonb_array_length(reports)>20 or jsonb_typeof(new.state->'closed') is distinct from 'array' then return new;end if;
 for r in select value from jsonb_array_elements(reports) loop
  -- Auxiliary malformed evidence must never stop an independent Stop Loss checkpoint.
  if jsonb_typeof(r)<>'object' or octet_length(r::text)>32768 or r->>'protocol' is distinct from 'REA-LEARNING-25.0.0' or r->>'mode' is distinct from 'LIVE' or r->>'simulation' is distinct from 'false' or coalesce(r->>'status','') not in('VERIFIED','INCOMPLETE') then continue;end if;
  if coalesce(r->>'positionId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or coalesce(r->>'closedAt','')!~'^[1-9][0-9]{0,14}$' or jsonb_typeof(r->'netPnL') is distinct from 'number' then continue;end if;
  select value into c from jsonb_array_elements(new.state->'closed') where value->>'id'=r->>'positionId';
  if c is null or c->'pnl' is distinct from r->'netPnL' or c->'closedAt' is distinct from r->'closedAt' or c->'symbol' is distinct from r->'symbol' then continue;end if;
  if not exists(select 1 from rea.live_orders o where o.user_id=new.user_id and o.client_order_id=(r->>'positionId')::uuid and o.payload->>'side'='BUY' and o.payload->>'symbol'=r->>'symbol') then continue;end if;
  insert into rea.trade_lessons(user_id,position_id,closed_at_ms,payload) values(new.user_id,(r->>'positionId')::uuid,(r->>'closedAt')::bigint,r) on conflict do nothing;
 end loop;
 return new;
end$$;
revoke all on function rea.archive_trade_lessons() from public,anon,authenticated;
grant execute on function rea.archive_trade_lessons() to service_role;
create trigger archive_trade_lessons after insert or update of latest on rea.live_accounts for each row execute function rea.archive_trade_lessons();

-- Keep the five existing trial ledgers. The backend upgrades them without resetting losses,
-- and starts a separate, matched two-account experience cohort at the actual upgrade time.
alter table rea.experiment_books drop constraint experiment_books_book_check;
alter table rea.experiment_books add constraint experiment_books_book_check check(jsonb_typeof(book)='object' and book->>'mode' is not distinct from 'PAPER_ONLY' and coalesce(book->>'protocol','') in('REA-EXPERIMENT-24.0.0','REA-EXPERIMENT-25.0.0') and octet_length(book::text)<=1048576);
create or replace function public.rea_experiment_checkpoint(
 p_uid uuid,p_lease uuid,p_revision bigint,p_state jsonb,p_latest jsonb,p_events jsonb,p_signals jsonb,p_fills jsonb,p_at bigint,p_book jsonb,p_error text default null
) returns boolean language plpgsql security invoker set search_path='' as $$
declare saved boolean;account_keys text[];expected_keys text[];a jsonb;protocol text;
begin
 protocol=p_book->>'protocol';
 if p_book->>'mode' is distinct from 'PAPER_ONLY' or coalesce(protocol,'') not in('REA-EXPERIMENT-24.0.0','REA-EXPERIMENT-25.0.0') or jsonb_typeof(p_book->'accounts') is distinct from 'object' or octet_length(p_book::text)>1048576 then raise exception 'INVALID_PAPER_EXPERIMENT_PROTOCOL';end if;
 if p_book->>'lastAt' is distinct from p_at::text or p_latest->'experiments'->>'at' is distinct from p_at::text or p_latest->'experiments'->>'protocol' is distinct from protocol or p_latest->'experiments'->>'mode' is distinct from 'PAPER_ONLY' then raise exception 'EXPERIMENT_SNAPSHOT_MISMATCH';end if;
 expected_keys=case when protocol='REA-EXPERIMENT-24.0.0' then array['BREAKOUT','CAUTIOUS_MIXED','MEAN_REVERSION','MIXED','TREND'] else array['BREAKOUT','CAUTIOUS_MIXED','EXPERIENCE_BASELINE','EXPERIENCE_GUARDED','MEAN_REVERSION','MIXED','TREND'] end;
 select array_agg(key order by key) into account_keys from jsonb_object_keys(p_book->'accounts') as k(key);
 if account_keys is distinct from expected_keys then raise exception 'INVALID_PAPER_EXPERIMENT_ACCOUNTS';end if;
 if protocol='REA-EXPERIMENT-25.0.0' and (jsonb_typeof(p_book->'experience') is distinct from 'object' or coalesce(p_book->'experience'->>'startedAt','')!~'^[1-9][0-9]{0,14}$' or (p_book->'experience'->>'startedAt')::bigint>p_at or p_book->'accounts'->'EXPERIENCE_BASELINE'->'startedAt' is distinct from p_book->'experience'->'startedAt' or p_book->'accounts'->'EXPERIENCE_GUARDED'->'startedAt' is distinct from p_book->'experience'->'startedAt') then raise exception 'INVALID_EXPERIENCE_COHORT';end if;
 for a in select value->'state' from jsonb_each(p_book->'accounts') loop
  if a->>'mode' is distinct from 'PAPER_ONLY' or a->>'initialCapital' is distinct from '10000' or (a->>'cash')::numeric<0 or a->>'lastAt' is distinct from p_at::text then raise exception 'INVALID_PAPER_EXPERIMENT_STATE';end if;
  if (select count(distinct symbol) from (select p->>'symbol' as symbol from jsonb_array_elements(a->'positions')p union all select o->>'symbol' from jsonb_array_elements(a->'orders')o where o->>'side'='BUY' and o->>'status' in('OPEN','PARTIAL'))q)>2 then raise exception 'EXPERIMENT_POSITION_LIMIT';end if;
 end loop;
 -- A rolling old worker must never overwrite an already-upgraded experience cohort.
 if protocol='REA-EXPERIMENT-24.0.0' and exists(select 1 from rea.experiment_books where user_id=p_uid and book->>'protocol'='REA-EXPERIMENT-25.0.0') then raise exception 'EXPERIMENT_PROTOCOL_DOWNGRADE';end if;
 saved=public.rea_checkpoint(p_uid,p_lease,p_revision,p_state,p_latest,p_events,p_signals,p_fills,p_at,p_error);
 if not saved then return false;end if;
 insert into rea.experiment_books(user_id,last_at,book) values(p_uid,p_at,p_book)
 on conflict(user_id) do update set last_at=excluded.last_at,book=excluded.book,updated_at=now() where rea.experiment_books.last_at<=excluded.last_at;
 if not found then raise exception 'EXPERIMENT_CLOCK_REGRESSION';end if;
 return true;
end$$;

create or replace function public.rea_live_scan_targets(p_uid uuid default null) returns jsonb
language sql security invoker set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('paper_user_id',a.user_id,'state',a.state,'paper_experience',b.latest->'experiments'->'relay')),'[]')
 from rea.live_accounts a join rea.bot_settings b using(user_id)
 where a.mode='LIVE_ENABLED' and a.state is not null and (p_uid is null or a.user_id=p_uid);
$$;
create or replace function public.rea_live_view(p_uid uuid) returns jsonb
language sql security invoker set search_path='' as $$
 select jsonb_build_object('mode',mode,'state',state,'preflight',preflight,'latest',latest,'updatedAt',updated_at,'lastError',last_error,'readiness',public.rea_live_ready(p_uid),
 'orders',(select coalesce(jsonb_agg(x order by created_at desc),'[]') from(select client_order_id,client_id,exchange_id,status,payload,created_at from rea.live_orders where user_id=p_uid order by created_at desc limit 100)x),
 'fills',(select coalesce(jsonb_agg(x order by created_at desc),'[]') from(select txn_id,payload,created_at from rea.live_fills where user_id=p_uid order by created_at desc limit 100)x),
 'curve',(select coalesce(jsonb_agg(x order by at_ms),'[]') from(select at_ms,equity,day,pnl from rea.live_equity where user_id=p_uid order by at_ms desc limit 1440)x),
 'tradeLessons',(select coalesce(jsonb_agg(payload order by closed_at_ms desc),'[]') from(select payload,closed_at_ms from rea.trade_lessons where user_id=p_uid order by closed_at_ms desc limit 100)x),
 'approval',case when approval is null then null else jsonb_build_object('at',approval->'at','spec',approval->'spec','capital',approval->'capital','policy',approval->'policy') end)
 from rea.live_accounts where user_id=p_uid;
$$;
notify pgrst,'reload schema';
commit;
