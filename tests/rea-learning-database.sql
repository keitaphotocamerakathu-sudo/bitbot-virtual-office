-- Synthetic owners and receipts, real backend role, no HTTP. Every mutation rolls back.
begin;
insert into auth.users(id,aud,role,email) values('fa777777-7777-4777-8777-777777777777','authenticated','authenticated','rea-learning@example.invalid'),('fa888888-8888-4888-8888-888888888888','authenticated','authenticated','rea-learning-other@example.invalid');
insert into rea.bot_settings(user_id,state) select id,'{"mode":"PAPER_ONLY","initialCapital":10000,"cash":10000}'::jsonb from auth.users where id in('fa777777-7777-4777-8777-777777777777','fa888888-8888-4888-8888-888888888888');
insert into rea.live_accounts(user_id,mode,state) select user_id,'LIVE_ENABLED','{"mode":"LIVE","orders":[],"closed":[]}'::jsonb from rea.bot_settings where user_id in('fa777777-7777-4777-8777-777777777777','fa888888-8888-4888-8888-888888888888');
set local role service_role;
do $$declare u uuid='fa777777-7777-4777-8777-777777777777';v uuid='fa888888-8888-4888-8888-888888888888';p uuid='fa999999-9999-4999-8999-999999999999';l uuid=gen_random_uuid();t bigint=floor(extract(epoch from now())*1000);r jsonb;s jsonb;b jsonb;oldbook jsonb;next_latest jsonb;bad jsonb;targets jsonb;begin
 if has_table_privilege('anon','rea.trade_lessons','SELECT') or has_table_privilege('authenticated','rea.trade_lessons','SELECT') or has_table_privilege('authenticated','rea.trade_lessons','INSERT') or has_table_privilege('service_role','rea.trade_lessons','UPDATE') or has_table_privilege('service_role','rea.trade_lessons','DELETE') then raise exception 'LESSONS_NOT_PRIVATE_APPEND_ONLY';end if;
 if (select relrowsecurity from pg_class where oid='rea.trade_lessons'::regclass) is not true then raise exception 'LESSON_RLS_MISSING';end if;
 if has_function_privilege('authenticated','public.rea_live_view(uuid)','EXECUTE') or has_function_privilege('anon','public.rea_live_scan_targets(uuid)','EXECUTE') then raise exception 'CROSS_OWNER_API_EXPOSED';end if;
 insert into rea.live_orders(user_id,client_order_id,client_id,status,payload) values(u,p,'test-learning','FILLED',jsonb_build_object('id',p,'side','BUY','symbol','BTC_THB'));
 r=jsonb_build_object('protocol','REA-LEARNING-25.0.0','mode','LIVE','simulation',false,'status','VERIFIED','positionId',p,'closedAt',t,'symbol','BTC_THB','netPnL',-2,'summary','Original observed loss');
 update rea.live_accounts set state=jsonb_set(state,'{closed}',jsonb_build_array(jsonb_build_object('id',p,'symbol','BTC_THB','closedAt',t,'pnl',-2))) where user_id in(u,v);
 update rea.live_accounts a set latest=jsonb_build_object('learning',jsonb_build_object('protocol','REA-LEARNING-25.0.0','at',t,'reports',jsonb_build_array(r))) where user_id=u;
 if (select count(*) from rea.trade_lessons where user_id=u)<>1 then raise exception 'LESSON_NOT_ARCHIVED';end if;
 update rea.live_accounts set latest=jsonb_set(latest,'{riskAt}',to_jsonb(t+1000)) where user_id=u;
 update rea.live_accounts set latest=jsonb_set(latest,'{learning,reports}',jsonb_build_array(r||'{"summary":"Attempted overwrite"}')) where user_id=u;
 if (select count(*) from rea.trade_lessons where user_id=u)<>1 or (select payload->>'summary' from rea.trade_lessons where user_id=u)<>'Original observed loss' then raise exception 'LESSON_REPLAY_OR_OVERWRITE';end if;
 update rea.live_accounts set latest=jsonb_build_object('learning',jsonb_build_object('protocol','REA-LEARNING-25.0.0','reports',jsonb_build_array(r))) where user_id=v;
 if exists(select 1 from rea.trade_lessons where user_id=v) then raise exception 'ANOTHER_OWNER_LESSON_ARCHIVED';end if;
 -- Malformed auxiliary evidence and false P&L cannot abort a stop/risk checkpoint.
 update rea.live_accounts set latest=jsonb_build_object('learning',jsonb_build_object('protocol','REA-LEARNING-25.0.0','reports',jsonb_build_array(r||'{"netPnL":99}'))) where user_id=u;
 update rea.live_accounts set latest=jsonb_build_object('learning',jsonb_build_object('protocol','REA-LEARNING-25.0.0','reports',jsonb_build_array(r||'{"positionId":"bad","closedAt":"bad"}'))) where user_id=u;
 update rea.live_accounts set latest=jsonb_build_object('learning','{"protocol":"REA-LEARNING-25.0.0","reports":{}}'::jsonb) where user_id=u;
 if jsonb_array_length(public.rea_live_view(u)->'tradeLessons')<>1 or jsonb_array_length(public.rea_live_view(v)->'tradeLessons')<>0 then raise exception 'OWNER_HISTORY_WRONG';end if;

 s=jsonb_build_object('version',1,'mode','PAPER_ONLY','initialCapital',10000,'cash',10000,'equity',10000,'dayStart',10000,'dayFlows',0,'day',(now() at time zone 'Asia/Bangkok')::date::text,'positions','[]'::jsonb,'orders','[]'::jsonb,'fills','[]'::jsonb,'closed','[]'::jsonb,'days','{}'::jsonb,'fees',0,'realized',0,'seen','{}'::jsonb,'peak',10000,'maxDrawdown',0,'kill','NONE','dailyLocked',false,'buyPaused',false,'baselinePending',false,'lastAt',t);
 oldbook=jsonb_build_object('protocol','REA-EXPERIMENT-24.0.0','mode','PAPER_ONLY','startedAt',t,'lastAt',t,'samples',1,'validSamples',1,'coveredMinutes',1,'validMinutes',1,'lastMinute',t/60000,'lastMinuteValid',true,'accounts',(select jsonb_object_agg(k,jsonb_build_object('state',s,'health','OK','markVerified',true,'stats','{"closedTrades":0,"wins":0,"grossGains":0,"grossLosses":0,"fillCount":0}'::jsonb)) from unnest(array['MIXED','TREND','BREAKOUT','MEAN_REVERSION','CAUTIOUS_MIXED'])k));
 b=jsonb_set(oldbook,'{protocol}','"REA-EXPERIMENT-25.0.0"');
 b=jsonb_set(b,'{experience}',jsonb_build_object('startedAt',t,'validMinutes',1,'lastMinute',t/60000,'lastMinuteValid',true));
 b=jsonb_set(b,'{accounts}',(select jsonb_object_agg(k,jsonb_build_object('startedAt',t,'state',s,'health','OK','markVerified',true,'lessons','[]'::jsonb,'stats','{"closedTrades":0,"wins":0,"grossGains":0,"grossLosses":0,"fillCount":0}'::jsonb)) from unnest(array['MIXED','TREND','BREAKOUT','MEAN_REVERSION','CAUTIOUS_MIXED','EXPERIENCE_BASELINE','EXPERIENCE_GUARDED'])k));
 next_latest=jsonb_build_object('at',t,'health','OK','quotes','[]'::jsonb,'experiments',jsonb_build_object('at',t,'mode','PAPER_ONLY','protocol','REA-EXPERIMENT-25.0.0','relay',jsonb_build_object('protocol','REA-EXPERIENCE-25.0.0','testOwner',u)));
 update rea.bot_settings set state=s,lease=l,lease_until=now()+interval '90 seconds',revision=0 where user_id=u;
 if public.rea_experiment_checkpoint(u,gen_random_uuid(),0,s,next_latest,'[]','[]','[]',t,b) then raise exception 'WRONG_LEASE_COMMITTED';end if;
 if not public.rea_experiment_checkpoint(u,l,0,s,next_latest,'[]','[]','[]',t,b) then raise exception 'SEVEN_ACCOUNT_CHECKPOINT_FAILED';end if;
 if (select count(*) from jsonb_object_keys(public.rea_experiment_state(u)->'accounts'))<>7 then raise exception 'SEVEN_ACCOUNTS_NOT_STORED';end if;
 bad=jsonb_set(b,'{accounts,EXPERIENCE_GUARDED,startedAt}',to_jsonb(t-60000));
 begin perform public.rea_experiment_checkpoint(u,l,1,s,next_latest,'[]','[]','[]',t,bad);raise exception 'UNMATCHED_COHORT_ACCEPTED';exception when others then if sqlerrm='UNMATCHED_COHORT_ACCEPTED' then raise;end if;end;
 bad=jsonb_set(next_latest,'{experiments,protocol}','"REA-EXPERIMENT-24.0.0"');
 begin perform public.rea_experiment_checkpoint(u,l,1,s,bad,'[]','[]','[]',t,oldbook);raise exception 'PROTOCOL_DOWNGRADE_ACCEPTED';exception when others then if sqlerrm='PROTOCOL_DOWNGRADE_ACCEPTED' then raise;end if;end;
 if (select revision from rea.bot_settings where user_id=u)<>1 then raise exception 'INVALID_EXPERIENCE_CHANGED_PARENT';end if;
 targets=public.rea_live_scan_targets(u);
 if jsonb_array_length(targets)<>1 or targets->0->>'paper_user_id'<>u::text or targets->0->'paper_experience'->>'testOwner'<>u::text then raise exception 'EXPERIENCE_OWNER_JOIN_FAILED';end if;
 targets=public.rea_live_scan_targets(v);
 if targets->0->'paper_experience' is distinct from 'null'::jsonb then raise exception 'ANOTHER_OWNER_EXPERIENCE_LEAKED';end if;
end$$;
reset role;
rollback;
select 'POST_TRADE_ARCHIVE_SEVEN_PAPER_OWNER_RELAY_RLS_REPLAY_TESTS_PASSED_ROLLED_BACK_NO_HTTP' as result;
