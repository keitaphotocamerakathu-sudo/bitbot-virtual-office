-- Synthetic owner only. Every fixture and dispatch ticket rolls back.
-- Dispatch here is a database authorization test; it invokes no HTTP or exchange.
begin;
do $$
declare u uuid=gen_random_uuid();l uuid=gen_random_uuid();other uuid=gen_random_uuid();t bigint=floor(extract(epoch from now())*1000);rev bigint;
 s jsonb;paper jsonb;o jsonb;orders jsonb='[]';b jsonb;r jsonb;pf jsonb;v_latest jsonb;n text;i integer;oid uuid;sellid uuid=gen_random_uuid();
begin
 insert into auth.users(id) values(u);
 paper=jsonb_build_object('version',1,'mode','PAPER_ONLY','initialCapital',10000,'cash',10000,'positions','[]'::jsonb,'orders','[]'::jsonb,'fills','[]'::jsonb,'closed','[]'::jsonb,'days','{}'::jsonb,'seen','{}'::jsonb,'day',(now() at time zone 'Asia/Bangkok')::date::text,'dayStart',10000,'dayFlows',0,'equity',10000,'dayPnl',0,'realized',0,'fees',0,'peak',10000,'maxDrawdown',0,'buyPaused',false,'dailyLocked',false,'baselinePending',false,'kill','NONE');
 insert into rea.bot_settings(user_id,state) values(u,paper);
 insert into rea.live_accounts(user_id) values(u);
 if (select max_positions from rea.live_accounts where user_id=u)<>2 then raise exception 'DEFAULT_TWO_CHANGED';end if;
 begin update rea.live_accounts set max_positions=6 where user_id=u;raise exception 'SIX_CAP_ACCEPTED';exception when check_violation then null;end;
 if has_table_privilege('authenticated','rea.live_accounts','UPDATE') or has_function_privilege('authenticated','public.rea_live_position_risk(jsonb,integer)','EXECUTE') or has_function_privilege('anon','public.rea_live_dispatch(uuid,uuid,bigint,uuid,text,jsonb,text)','EXECUTE') then raise exception 'LIVE_POLICY_EXPOSED';end if;
 s=paper||jsonb_build_object('mode','LIVE','policy','OWNER_LIMITED_LIVE','accounting','EXCHANGE_RECEIPTS','maxPositions',5,'allocatedCapital',99.97,'cash',99.97,'equity',99.97,'dayStart',99.97);
 for i in 0..4 loop
  o=jsonb_build_object('id',gen_random_uuid(),'clientId','TEST-27-'||i,'symbol',(array['BTC_THB','ETH_THB','SOL_THB','XRP_THB','ADA_THB'])[i+1],'side','BUY','status','RESERVED','type','limit','amount',10.74,'remaining',10.74,'executed',0,'limit',100,'stop',98,'target',104,'riskFraction',.027,'modeledLoss',.39,'quoteAt',t,'createdAt',t,'qtyScale',8,'appliedTxnIds','[]'::jsonb);
  orders=orders||jsonb_build_array(o);
 end loop;
 pf=jsonb_build_object('ok',true,'at',t,'keyFingerprint','TEST_ONLY_27','wallet',jsonb_build_object('THB',jsonb_build_object('available',99.97,'reserved',0)));
 v_latest=jsonb_build_object('at',t,'health','OK');
 update rea.live_accounts set max_positions=5,state=s,mode='LIVE_ENABLED',lease=l,lease_until=now()+interval '90 seconds',preflight=pf,latest=v_latest,approval=jsonb_build_object('spec','REA-LIVE-19.0','capital',99.97,'policy','OWNER_LIMITED_LIVE','launchSpec','REA-LIMITED-19.1','ownerAcknowledgement',jsonb_build_object('acceptIncomplete',true),'keyFingerprint','TEST_ONLY_27','owner',u,'positionPolicy',jsonb_build_object('spec','REA-POSITIONS-27.0','owner',u,'maxPositions',5,'riskBaselinePositions',2)) where user_id=u;
 foreach n in array array['EXECUTION_TESTS','RECOVERY_TESTS','LIMITED_CAPITAL_TESTS'] loop
  insert into rea.live_checks(user_id,check_name,passed,spec,evidence) values(u,n,true,case when n='LIMITED_CAPITAL_TESTS' then 'REA-LIMITED-19.1' else 'REA-LIVE-19.0' end,'{"testOnly":true}');
 end loop;
 perform public.rea_live_heartbeat(u,'risk','OK',t);
 if not(public.rea_live_ready(u)->'limited'->>'ready')::boolean then raise exception 'LIMITED_FIXTURE_NOT_READY';end if;
 s=jsonb_set(s,'{orders}',orders);
 r=public.rea_live_checkpoint(u,l,0,s,pf,v_latest,'[]','strategy');rev=(r->>'revision')::bigint;
 if rev is null or r->>'max_positions'<>'5' then raise exception 'FIVE_RESERVATIONS_FAILED';end if;
 if public.rea_live_view(u)->>'maxPositions'<>'5' then raise exception 'VIEW_LIMIT_MISSING';end if;
 r=public.rea_live_position_risk(s,5);
 if (r->>'portfolioRiskUsed')::numeric<>1.95 or (r->>'portfolioRiskBudget')::numeric<>1.98 then raise exception 'JS_SQL_RISK_MISMATCH: %',r;end if;
 begin perform public.rea_live_checkpoint(u,l,rev,s||'{"maxPositions":6}',pf,v_latest,'[]','strategy');raise exception 'WORKER_MUTATED_CAP';exception when others then if sqlerrm<>'LIVE_POSITION_POLICY_MISMATCH' then raise;end if;end;
 begin perform public.rea_live_checkpoint(u,l,rev,s||'{"allocatedCapital":100}',pf,v_latest,'[]','strategy');raise exception 'WORKER_MUTATED_CAPITAL';exception when others then if sqlerrm<>'LIVE_APPROVED_ALLOCATION_IMMUTABLE' then raise;end if;end;
 o=(orders->0)||jsonb_build_object('id',gen_random_uuid(),'clientId','SIXTH','symbol','XLM_THB','status','CANCEL_PENDING');
 begin perform public.rea_live_checkpoint(u,l,rev,jsonb_set(s,'{orders}',orders||jsonb_build_array(o)),pf,v_latest,'[]','strategy');raise exception 'SIXTH_RESERVATION_ACCEPTED';exception when others then if sqlerrm<>'LIVE_POSITION_LIMIT' then raise;end if;end;
 begin perform public.rea_live_checkpoint(u,l,rev,jsonb_set(s,'{orders}',orders||jsonb_build_array(o)),pf,v_latest,'[]','risk');raise exception 'WATCHDOG_OPENED_BUY';exception when others then if sqlerrm<>'LIVE_WATCHDOG_CANNOT_OPEN_BUY' then raise;end if;end;
 oid=(orders->0->>'id')::uuid;
 b=jsonb_build_object('sym','btc_thb','amt',10.74,'rat',100,'typ','limit','client_id','TEST-27-0');
 update rea.live_accounts set state=jsonb_set(s,'{orders}',orders||jsonb_build_array(o)) where user_id=u;
 begin perform public.rea_live_dispatch(u,l,rev,oid,'PLACE',b,'/api/v3/market/place-bid');raise exception 'DISPATCH_BYPASSED_SLOT_LIMIT';exception when others then if sqlerrm<>'LIVE_POSITION_LIMIT' then raise;end if;end;
 update rea.live_accounts set state=s,approval=jsonb_set(approval,'{positionPolicy,owner}',to_jsonb(other)) where user_id=u;
 begin perform public.rea_live_dispatch(u,l,rev,oid,'PLACE',b,'/api/v3/market/place-bid');raise exception 'WRONG_OWNER_APPROVAL';exception when others then if sqlerrm<>'LIVE_POSITION_LIMIT_NOT_APPROVED' then raise;end if;end;
 update rea.live_accounts set approval=jsonb_set(approval,'{positionPolicy,owner}',to_jsonb(u)),state=jsonb_set(s,'{orders,0,modeledLoss}','0.40') where user_id=u;
 begin perform public.rea_live_dispatch(u,l,rev,oid,'PLACE',b,'/api/v3/market/place-bid');raise exception 'UNREDUCED_TRADE_RISK_ACCEPTED';exception when others then if sqlerrm<>'LIVE_RISK_BUDGET_EXCEEDED' then raise;end if;end;
 update rea.live_accounts set state=jsonb_set(s,'{orders,0,modeledLoss}','0.01') where user_id=u;
 begin perform public.rea_live_dispatch(u,l,rev,oid,'PLACE',b,'/api/v3/market/place-bid');raise exception 'UNDERSTATED_RISK_ACCEPTED';exception when others then if sqlerrm<>'LIVE_RISK_ESTIMATE_INVALID' then raise;end if;end;
 update rea.live_accounts set state=jsonb_set(s,'{orders,0,riskFraction}','0.001') where user_id=u;
 begin perform public.rea_live_dispatch(u,l,rev,oid,'PLACE',b,'/api/v3/market/place-bid');raise exception 'CHEAP_FRICTION_ACCEPTED';exception when others then if sqlerrm<>'LIVE_RISK_ESTIMATE_INVALID' then raise;end if;end;
 update rea.live_accounts set state=s||'{"positions":[{"symbol":"BTC_THB","qty":0.4,"cost":50,"stop":90,"target":110}]}' where user_id=u;
 begin perform public.rea_live_dispatch(u,l,rev,oid,'PLACE',b,'/api/v3/market/place-bid');raise exception 'AGGREGATE_RISK_ACCEPTED';exception when others then if sqlerrm<>'LIVE_PORTFOLIO_RISK_EXCEEDED' then raise;end if;end;
 update rea.live_accounts set state=s||'{"dailyLocked":true}' where user_id=u;
 if (public.rea_live_dispatch(u,l,rev,oid,'PLACE',b,'/api/v3/market/place-bid')->>'allowed')::boolean then raise exception 'DAILY_LOCK_BYPASSED';end if;
 update rea.live_accounts set state=s where user_id=u;
 if (public.rea_live_dispatch(u,other,rev,oid,'PLACE',b,'/api/v3/market/place-bid')->>'allowed')::boolean then raise exception 'SECOND_EXECUTOR_ACCEPTED';end if;
 if (public.rea_live_dispatch(u,l,rev-1,oid,'PLACE',b,'/api/v3/market/place-bid')->>'allowed')::boolean then raise exception 'STALE_REVISION_ACCEPTED';end if;
 r=public.rea_live_dispatch(u,l,rev,oid,'PLACE',b,'/api/v3/market/place-bid');
 if not(r->>'allowed')::boolean then raise exception 'VALID_SMALL_TRADE_REJECTED: %',r;end if;rev=(r->>'revision')::bigint;
 if (public.rea_live_dispatch(u,l,rev,oid,'PLACE',b,'/api/v3/market/place-bid')->>'allowed')::boolean then raise exception 'DUPLICATE_TICKET_ACCEPTED';end if;
 -- An exhausted envelope and daily buy lock must still allow reducing a holding.
 o=jsonb_build_object('id',sellid,'clientId','TEST-27-SELL','symbol','BTC_THB','side','SELL','status','RESERVED','type','limit','amount',.4,'remaining',.4,'limit',90,'quoteAt',t,'createdAt',t);
 update rea.live_accounts set state=jsonb_set(s||'{"dailyLocked":true,"positions":[{"symbol":"BTC_THB","qty":0.4,"cost":50,"stop":90,"target":110}]}','{orders}',orders||jsonb_build_array(o)) where user_id=u;
 b=jsonb_build_object('sym','btc_thb','amt',.4,'rat',90,'typ','limit','client_id','TEST-27-SELL');
 r=public.rea_live_dispatch(u,l,rev,sellid,'PLACE',b,'/api/v3/market/place-ask');
 if not(r->>'allowed')::boolean then raise exception 'RISK_EXIT_BLOCKED: %',r;end if;
end$$;
rollback;
select 'FIVE_SLOT_POSTGRES_INTEGRITY_PASSED_NO_HTTP_SYNTHETIC_OWNER_ROLLED_BACK' as result;
