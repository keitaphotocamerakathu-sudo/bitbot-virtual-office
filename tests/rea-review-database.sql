-- Synthetic account, real backend role, no HTTP or exchange endpoints. All writes roll back.
begin;
insert into auth.users(id,aud,role,email) values('fa444444-4444-4444-8444-444444444444','authenticated','authenticated','rea-team-review@example.invalid');
insert into rea.bot_settings(user_id,state) select 'fa444444-4444-4444-8444-444444444444',state from rea.bot_settings limit 1;
insert into rea.live_accounts(user_id,state) select 'fa444444-4444-4444-8444-444444444444',state from rea.live_accounts limit 1;
set local role service_role;
do $$declare u uuid='fa444444-4444-4444-8444-444444444444';receipt jsonb;stamp bigint=1794974400123;v jsonb;begin
 if not exists(select 1 from rea.live_accounts where user_id=u) then raise exception 'TEST_FIXTURE_MISSING';end if;
 if has_table_privilege('anon','rea.review_cycles','SELECT') or has_table_privilege('authenticated','rea.review_cycles','SELECT') or has_table_privilege('authenticated','rea.review_cycles','INSERT') then raise exception 'PRIVATE_REVIEW_EXPOSED';end if;
 if has_table_privilege('service_role','rea.review_cycles','UPDATE') or has_table_privilege('service_role','rea.review_cycles','DELETE') then raise exception 'AUDIT_NOT_APPEND_ONLY';end if;
 receipt=jsonb_build_object('version','22.0.0','at',stamp,'method','DETERMINISTIC_SHARED_SNAPSHOT','reviewers',7,'reviews',(select jsonb_agg(jsonb_build_object('role',r,'status','COMPLETED','at',stamp)) from unnest(array['Data Integrity Auditor','Liquidity Reviewer','Multi-timeframe Analyst','Signal Challenger','Cost & Exit Reviewer','Portfolio Auditor','Performance Monitor'])r),'timings','{"pipelineMs":100,"walletReads":1}'::jsonb,'blockedSymbols','[]'::jsonb);
 update rea.live_accounts set latest=jsonb_build_object('team',receipt,'at',stamp) where user_id=u;
 if (select count(*) from rea.review_cycles where user_id=u and mode='LIVE')<>1 then raise exception 'LIVE_EVIDENCE_NOT_SAVED';end if;
 -- A stop/risk heartbeat and an identical repeated checkpoint cannot duplicate the strategy evidence.
 update rea.live_accounts set latest=latest||jsonb_build_object('riskAt',stamp+1000) where user_id=u;
 update rea.live_accounts set latest=jsonb_build_object('team',receipt,'at',stamp+2000) where user_id=u;
 if (select count(*) from rea.review_cycles where user_id=u and mode='LIVE')<>1 then raise exception 'DUPLICATE_EVIDENCE';end if;
 update rea.bot_settings set latest=jsonb_build_object('team',receipt) where user_id=u;
 if (select count(*) from rea.review_cycles where user_id=u)<>2 then raise exception 'PAPER_LIVE_EVIDENCE_COLLISION';end if;
 update rea.live_accounts set latest=jsonb_build_object('team',jsonb_set(receipt,'{at}',to_jsonb(stamp+1))) where user_id=u;
 select payload into v from rea.review_cycles where user_id=u and mode='LIVE' and at_ms=stamp;
 if v<>receipt then raise exception 'HISTORICAL_EVIDENCE_CHANGED';end if;
 -- Malformed or oversized auxiliary receipts are skipped without blocking the checkpoint.
 update rea.live_accounts set latest=jsonb_build_object('team',receipt||'{"at":"invalid"}') where user_id=u;
 update rea.live_accounts set latest=jsonb_build_object('team',receipt||'{"reviews":{}}') where user_id=u;
 update rea.live_accounts set latest=jsonb_build_object('team',receipt||jsonb_build_object('at',stamp+2,'extra',repeat('X',65536))) where user_id=u;
 if (select count(*) from rea.review_cycles where user_id=u)<>3 then raise exception 'INVALID_EVIDENCE_SAVED';end if;
 if (select relrowsecurity from pg_class where oid='rea.review_cycles'::regclass) is not true then raise exception 'RLS_MISSING';end if;
end$$;
reset role;
rollback;
select 'REVIEW_HISTORY_BACKEND_ROLE_PASSED_NO_HTTP_ROLLED_BACK' as result;
