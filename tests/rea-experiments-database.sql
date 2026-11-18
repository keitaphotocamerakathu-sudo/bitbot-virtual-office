-- Synthetic owner and simulated ledgers only. Real service_role; every change rolls back.
-- No HTTP calls, credentials, Live activation, Place Bid or Place Ask.
begin;
insert into auth.users(id,aud,role,email) values('fa666666-6666-4666-8666-666666666666','authenticated','authenticated','rea-experiments@example.invalid');
insert into rea.bot_settings(user_id,state) values('fa666666-6666-4666-8666-666666666666','{"mode":"PAPER_ONLY","initialCapital":10000,"cash":10000}');
set local role service_role;
do $$declare u uuid='fa666666-6666-4666-8666-666666666666';l uuid=gen_random_uuid();other uuid=gen_random_uuid();t bigint=floor(extract(epoch from now())*1000);s jsonb;b jsonb;latest jsonb;bad jsonb;begin
 if has_table_privilege('authenticated','rea.experiment_books','SELECT') or has_table_privilege('anon','rea.experiment_books','INSERT') or has_function_privilege('authenticated','public.rea_experiment_state(uuid)','EXECUTE') or has_function_privilege('anon','public.rea_experiment_checkpoint(uuid,uuid,bigint,jsonb,jsonb,jsonb,jsonb,jsonb,bigint,jsonb,text)','EXECUTE') then raise exception 'EXPERIMENTS_EXPOSED';end if;
 if (select relrowsecurity from pg_class where oid='rea.experiment_books'::regclass) is not true then raise exception 'EXPERIMENT_RLS_MISSING';end if;
 s=jsonb_build_object('version',1,'mode','PAPER_ONLY','initialCapital',10000,'cash',10000,'equity',10000,'dayStart',10000,'dayFlows',0,'day',(now() at time zone 'Asia/Bangkok')::date::text,'positions','[]'::jsonb,'orders','[]'::jsonb,'fills','[]'::jsonb,'closed','[]'::jsonb,'days','{}'::jsonb,'fees',0,'realized',0,'seen','{}'::jsonb,'peak',10000,'maxDrawdown',0,'kill','NONE','dailyLocked',false,'buyPaused',false,'baselinePending',false,'lastAt',t);
 b=jsonb_build_object('protocol','REA-EXPERIMENT-24.0.0','mode','PAPER_ONLY','startedAt',t,'lastAt',t,'samples',1,'validSamples',1,'coveredMinutes',1,'validMinutes',1,'lastMinute',t/60000,'lastMinuteValid',true,'accounts',(select jsonb_object_agg(k,jsonb_build_object('state',s,'health','OK','markVerified',true,'stats','{"closedTrades":0,"wins":0,"grossGains":0,"grossLosses":0,"fillCount":0}'::jsonb)) from unnest(array['MIXED','TREND','BREAKOUT','MEAN_REVERSION','CAUTIOUS_MIXED'])k));
 latest=jsonb_build_object('at',t,'health','OK','quotes','[]'::jsonb,'experiments',jsonb_build_object('at',t,'protocol','REA-EXPERIMENT-24.0.0','mode','PAPER_ONLY','accounts','[]'::jsonb),'team',jsonb_build_object('at',t,'method','DETERMINISTIC_SHARED_SNAPSHOT','reviewers',9,'reviews',(select jsonb_agg(jsonb_build_object('role','SQL_TEST_'||i,'at',t)) from generate_series(1,9)i)));
 update rea.bot_settings set state=s,lease=l,lease_until=now()+interval '90 seconds',revision=0 where user_id=u;
 if public.rea_experiment_checkpoint(u,other,0,s,latest,'[]','[]','[]',t,b) then raise exception 'WRONG_LEASE_COMMITTED';end if;
 if public.rea_experiment_state(u) is not null or (select revision from rea.bot_settings where user_id=u)<>0 then raise exception 'PARTIAL_CHECKPOINT';end if;
 if not public.rea_experiment_checkpoint(u,l,0,s,latest,'[]','[]','[]',t,b) then raise exception 'VALID_CHECKPOINT_REJECTED';end if;
 if public.rea_experiment_state(u) is distinct from b or (select revision from rea.bot_settings where user_id=u)<>1 then raise exception 'ATOMIC_BOOK_NOT_SAVED';end if;
 if (select payload->>'reviewers' from rea.review_cycles where user_id=u and mode='PAPER' and at_ms=t) is distinct from '9' then raise exception 'NEW_REVIEW_HISTORY_MISSING';end if;
 if public.rea_experiment_checkpoint(u,l,0,s,latest,'[]','[]','[]',t,b) then raise exception 'REPLAY_COMMITTED';end if;
 if public.rea_experiment_checkpoint(other,l,0,s,latest,'[]','[]','[]',t,b) then raise exception 'OTHER_OWNER_COMMITTED';end if;
 update rea.bot_settings set lease=l,lease_until=now()+interval '90 seconds' where user_id=u;
 bad=jsonb_set(b,'{accounts,TREND,state,mode}','"LIVE"');
 begin perform public.rea_experiment_checkpoint(u,l,1,s,latest,'[]','[]','[]',t,bad);raise exception 'LIVE_EXPERIMENT_ACCEPTED';exception when others then if sqlerrm='LIVE_EXPERIMENT_ACCEPTED' then raise;end if;end;
 if public.rea_experiment_state(u) is distinct from b or (select revision from rea.bot_settings where user_id=u)<>1 then raise exception 'INVALID_BOOK_CHANGED_PARENT';end if;
 -- Clock regression after the parent update must roll the entire transaction back.
 bad=jsonb_set(b,'{lastAt}',to_jsonb(t-1));
 bad=jsonb_set(bad,'{accounts}',(select jsonb_object_agg(key,jsonb_set(value,'{state,lastAt}',to_jsonb(t-1))) from jsonb_each(bad->'accounts')));
 begin perform public.rea_experiment_checkpoint(u,l,1,jsonb_set(s,'{lastAt}',to_jsonb(t-1)),jsonb_set(jsonb_set(latest,'{at}',to_jsonb(t-1)),'{experiments,at}',to_jsonb(t-1)),'[]','[]','[]',t-1,bad);raise exception 'CLOCK_REGRESSION_ACCEPTED';exception when others then if sqlerrm='CLOCK_REGRESSION_ACCEPTED' then raise;end if;end;
 if (select revision from rea.bot_settings where user_id=u)<>1 or public.rea_experiment_state(u) is distinct from b then raise exception 'REGRESSION_NOT_ATOMIC';end if;
 if exists(select 1 from rea.live_accounts where user_id=u) then raise exception 'RESEARCH_CREATED_LIVE_ACCOUNT';end if;
end$$;
reset role;
rollback;
select 'FIVE_PAPER_BOOKS_ATOMIC_ROLE_RLS_REPLAY_TESTS_PASSED_ROLLED_BACK_NO_HTTP' as result;
