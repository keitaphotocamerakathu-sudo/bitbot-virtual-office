-- Isolated Paper entry/profit-protection study. Preserve all seven existing ledgers.
begin;
alter table rea.experiment_books drop constraint experiment_books_book_check;
alter table rea.experiment_books add constraint experiment_books_book_check check(jsonb_typeof(book)='object' and book->>'mode' is not distinct from 'PAPER_ONLY' and coalesce(book->>'protocol','') in('REA-EXPERIMENT-24.0.0','REA-EXPERIMENT-25.0.0','REA-EXPERIMENT-26.0.0') and octet_length(book::text)<=1048576);
create or replace function public.rea_experiment_checkpoint(
 p_uid uuid,p_lease uuid,p_revision bigint,p_state jsonb,p_latest jsonb,p_events jsonb,p_signals jsonb,p_fills jsonb,p_at bigint,p_book jsonb,p_error text default null
) returns boolean language plpgsql security invoker set search_path='' as $$
declare saved boolean;account_keys text[];expected_keys text[];a jsonb;protocol text;previous_book jsonb;kv record;metric text;
begin
 protocol=p_book->>'protocol';
 if p_book->>'mode' is distinct from 'PAPER_ONLY' or coalesce(protocol,'') not in('REA-EXPERIMENT-24.0.0','REA-EXPERIMENT-25.0.0','REA-EXPERIMENT-26.0.0') or jsonb_typeof(p_book->'accounts') is distinct from 'object' or octet_length(p_book::text)>1048576 then raise exception 'INVALID_PAPER_EXPERIMENT_PROTOCOL';end if;
 if p_book->>'lastAt' is distinct from p_at::text or p_latest->'experiments'->>'at' is distinct from p_at::text or p_latest->'experiments'->>'protocol' is distinct from protocol or p_latest->'experiments'->>'mode' is distinct from 'PAPER_ONLY' then raise exception 'EXPERIMENT_SNAPSHOT_MISMATCH';end if;
 expected_keys=case when protocol='REA-EXPERIMENT-24.0.0' then array['BREAKOUT','CAUTIOUS_MIXED','MEAN_REVERSION','MIXED','TREND'] when protocol='REA-EXPERIMENT-25.0.0' then array['BREAKOUT','CAUTIOUS_MIXED','EXPERIENCE_BASELINE','EXPERIENCE_GUARDED','MEAN_REVERSION','MIXED','TREND'] else array['BREAKOUT','CAUTIOUS_MIXED','ENTRY_PROTECT','EXIT_BASELINE','EXIT_PROTECT','EXPERIENCE_BASELINE','EXPERIENCE_GUARDED','MEAN_REVERSION','MIXED','TREND'] end;
 select array_agg(key order by key) into account_keys from jsonb_object_keys(p_book->'accounts') as k(key);
 if account_keys is distinct from expected_keys then raise exception 'INVALID_PAPER_EXPERIMENT_ACCOUNTS';end if;
 if protocol in('REA-EXPERIMENT-25.0.0','REA-EXPERIMENT-26.0.0') and (jsonb_typeof(p_book->'experience') is distinct from 'object' or coalesce(p_book->'experience'->>'startedAt','')!~'^[1-9][0-9]{0,14}$' or (p_book->'experience'->>'startedAt')::bigint>p_at or p_book->'accounts'->'EXPERIENCE_BASELINE'->'startedAt' is distinct from p_book->'experience'->'startedAt' or p_book->'accounts'->'EXPERIENCE_GUARDED'->'startedAt' is distinct from p_book->'experience'->'startedAt') then raise exception 'INVALID_EXPERIENCE_COHORT';end if;
 for a in select value->'state' from jsonb_each(p_book->'accounts') loop
  if a->>'mode' is distinct from 'PAPER_ONLY' or a->>'initialCapital' is distinct from '10000' or (a->>'cash')::numeric<0 or a->>'lastAt' is distinct from p_at::text then raise exception 'INVALID_PAPER_EXPERIMENT_STATE';end if;
  if (select count(distinct symbol) from (select p->>'symbol' as symbol from jsonb_array_elements(a->'positions')p union all select o->>'symbol' from jsonb_array_elements(a->'orders')o where o->>'side'='BUY' and o->>'status' in('OPEN','PARTIAL'))q)>2 then raise exception 'EXPERIMENT_POSITION_LIMIT';end if;
 end loop;
 -- A rolling old worker must never overwrite an already-upgraded experience cohort.
 select book into previous_book from rea.experiment_books where user_id=p_uid;
 if previous_book is not null then
  if previous_book->>'protocol'='REA-EXPERIMENT-26.0.0' and protocol<>'REA-EXPERIMENT-26.0.0' or previous_book->>'protocol'='REA-EXPERIMENT-25.0.0' and protocol='REA-EXPERIMENT-24.0.0' then raise exception 'EXPERIMENT_PROTOCOL_DOWNGRADE';end if;
  if p_book->'startedAt' is distinct from previous_book->'startedAt' then raise exception 'EXPERIMENT_START_RESET';end if;
  if previous_book ? 'experience' and p_book->'experience'->'startedAt' is distinct from previous_book->'experience'->'startedAt' then raise exception 'EXPERIENCE_START_RESET';end if;
  if previous_book ? 'positionStudy' and p_book->'positionStudy'->'startedAt' is distinct from previous_book->'positionStudy'->'startedAt' then raise exception 'POSITION_STUDY_START_RESET';end if;
  for kv in select key,value from jsonb_each(previous_book->'accounts') loop
   foreach metric in array array['closedTrades','wins','grossGains','grossLosses','fillCount'] loop
    if jsonb_typeof(p_book->'accounts'->kv.key->'stats'->metric) is distinct from 'number' or (p_book->'accounts'->kv.key->'stats'->>metric)::numeric<(kv.value->'stats'->>metric)::numeric then raise exception 'EXPERIMENT_HISTORY_REGRESSION';end if;
   end loop;
   if (p_book->'accounts'->kv.key->'state'->>'fees')::numeric<(kv.value->'state'->>'fees')::numeric or kv.value ? 'startedAt' and p_book->'accounts'->kv.key->'startedAt' is distinct from kv.value->'startedAt' then raise exception 'EXPERIMENT_HISTORY_REGRESSION';end if;
  end loop;
 end if;
 if protocol='REA-EXPERIMENT-26.0.0' then
  if jsonb_typeof(p_book->'positionStudy') is distinct from 'object' or coalesce(p_book->'positionStudy'->>'startedAt','')!~'^[1-9][0-9]{0,14}$' then raise exception 'INVALID_POSITION_STUDY';end if;
  if (p_book->'positionStudy'->>'startedAt')::bigint>p_at then raise exception 'FUTURE_POSITION_STUDY';end if;
  foreach metric in array array['EXIT_BASELINE','EXIT_PROTECT','ENTRY_PROTECT'] loop
   if p_book->'accounts'->metric->'startedAt' is distinct from p_book->'positionStudy'->'startedAt' then raise exception 'UNMATCHED_POSITION_STUDY';end if;
  end loop;
 end if;
 saved=public.rea_checkpoint(p_uid,p_lease,p_revision,p_state,p_latest,p_events,p_signals,p_fills,p_at,p_error);
 if not saved then return false;end if;
 insert into rea.experiment_books(user_id,last_at,book) values(p_uid,p_at,p_book)
 on conflict(user_id) do update set last_at=excluded.last_at,book=excluded.book,updated_at=now() where rea.experiment_books.last_at<=excluded.last_at;
 if not found then raise exception 'EXPERIMENT_CLOCK_REGRESSION';end if;
 return true;
end$$;

create or replace function public.rea_live_scan_targets(p_uid uuid default null) returns jsonb
language sql security invoker set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('paper_user_id',a.user_id,'state',a.state,'paper_experience',b.latest->'experiments'->'relay','position_study',b.latest->'experiments'->'positionStudy')),'[]')
 from rea.live_accounts a join rea.bot_settings b using(user_id)
 where a.mode='LIVE_ENABLED' and a.state is not null and (p_uid is null or a.user_id=p_uid);
$$;
notify pgrst,'reload schema';
commit;
