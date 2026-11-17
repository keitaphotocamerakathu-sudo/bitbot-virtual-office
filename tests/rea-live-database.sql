-- All synthetic readiness/market fixtures are rolled back.
-- This test never invokes HTTP, signing, Place Bid or Place Ask.
begin;
do $$declare u uuid;l uuid=gen_random_uuid();other uuid=gen_random_uuid();oid uuid=gen_random_uuid();s jsonb;o jsonb;r jsonb;b jsonb;n text;t bigint=floor(extract(epoch from now())*1000);rev bigint;begin
 select user_id into u from rea.live_accounts limit 1;if u is null then raise exception 'LIVE_ACCOUNT_REQUIRED';end if;
 if (public.rea_live_ready(u)->>'ready')::boolean then raise exception 'UNREVIEWED_LIVE_READY';end if;
 r=public.rea_live_control(u,'activate','เปิดซื้อขายจริง Bitkub','{"mode":"LIVE"}');
 if coalesce((r->>'activated')::boolean,false) then raise exception 'PREMATURE_LIVE_ACTIVATION';end if;
 if has_function_privilege('authenticated','public.rea_live_control(uuid,text,text,jsonb)','EXECUTE') or has_function_privilege('anon','public.rea_live_dispatch(uuid,uuid,bigint,uuid,text,jsonb,text)','EXECUTE') then raise exception 'LIVE_SERVICE_EXPOSED';end if;
 s=jsonb_build_object('version',1,'mode','LIVE','accounting','EXCHANGE_RECEIPTS','initialCapital',10000,'allocatedCapital',10000,'cash',10000,'equity',10000,'dayStart',10000,'dayPnl',0,'dayFlows',0,'day',(now() at time zone 'Asia/Bangkok')::date::text,'dailyLocked',false,'baselinePending',false,'buyPaused',false,'kill','NONE','positions','[]'::jsonb,'orders','[]'::jsonb,'fills','[]'::jsonb,'closed','[]'::jsonb,'days','{}'::jsonb,'seen','{}'::jsonb,'realized',0,'fees',0,'peak',10000,'maxDrawdown',0);
 o=jsonb_build_object('id',oid,'clientId','rea19-sql-only','symbol','BTC_THB','side','BUY','type','limit','limit',100,'amount',1000,'remaining',1000,'executed',0,'modeledLoss',27,'riskFraction',.027,'status','RESERVED','createdAt',t,'quoteAt',t,'qtyScale',8,'stop',98,'target',104,'appliedTxnIds','[]'::jsonb);
 update rea.live_accounts set mode='LIVE_ENABLED',state=s,lease=l,lease_until=now()+interval '90 seconds',revision=0,preflight=jsonb_build_object('ok',true,'at',t,'keyFingerprint','TEST_ONLY','wallet',jsonb_build_object('THB',jsonb_build_object('available',10000,'reserved',0))),approval='{"spec":"REA-LIVE-19.0","keyFingerprint":"TEST_ONLY"}',latest=jsonb_build_object('at',t,'health','OK') where user_id=u;
 begin
  perform public.rea_live_checkpoint(u,l,0,jsonb_set(s,'{orders}',jsonb_build_array(o)),(select preflight from rea.live_accounts where user_id=u),jsonb_build_object('at',t,'health','OK'),'[]','risk',null);
  raise exception 'WATCHDOG_BUY_ACCEPTED';
 exception when others then if sqlerrm='WATCHDOG_BUY_ACCEPTED' then raise;end if;end;
 r=public.rea_live_checkpoint(u,l,0,jsonb_set(s,'{orders}',jsonb_build_array(o)),(select preflight from rea.live_accounts where user_id=u),jsonb_build_object('at',t,'health','OK'),'[]','strategy',null);
 if r is null then raise exception 'RESERVATION_FAILED';end if;rev=(r->>'revision')::bigint;
 b=jsonb_build_object('sym','btc_thb','amt',1000,'rat',100,'typ','limit','client_id','rea19-sql-only');
 if (public.rea_live_dispatch(u,l,rev,oid,'PLACE',b,'/api/v3/market/place-bid')->>'allowed')::boolean then raise exception 'MISSING_ACCEPTANCE_ALLOWED';end if;
 if (public.rea_live_dispatch(u,other,rev,oid,'PLACE',b,'/api/v3/market/place-bid')->>'allowed')::boolean then raise exception 'WRONG_EXECUTOR_ALLOWED';end if;
 -- Fixture only: model a complete observation window in this uncommitted transaction.
 insert into rea.equity_snapshots(user_id,at_ms,equity)
 select u,t-604800000+g*60000,10000 from generate_series(0,10080)g on conflict do nothing;
 foreach n in array array['EXECUTION_TESTS','RECOVERY_TESTS','RECONCILIATION_REVIEW','SECURITY_REVIEW','NO_WITHDRAW_SCOPE','OWNER_ALERT_DELIVERY'] loop
  insert into rea.live_checks(user_id,check_name,passed,evidence) values(u,n,true,'{"testOnly":true,"keyFingerprint":"TEST_ONLY"}') on conflict(user_id,check_name) do update set passed=true,spec='REA-LIVE-19.0',expires_at=null,evidence=excluded.evidence;
 end loop;
 perform public.rea_live_heartbeat(u,'risk','OK',t);
 if not (public.rea_live_ready(u)->>'ready')::boolean then raise exception 'COMPLETE_FIXTURE_NOT_READY: %',public.rea_live_ready(u);end if;
 update rea.live_accounts set preflight=jsonb_set(preflight,'{keyFingerprint}','"CHANGED_KEY"') where user_id=u;
 if (public.rea_live_ready(u)->>'ready')::boolean then raise exception 'KEY_SCOPE_REVIEW_REUSED_FOR_DIFFERENT_KEY';end if;
 update rea.live_accounts set preflight=jsonb_set(preflight,'{keyFingerprint}','"TEST_ONLY"') where user_id=u;
 if (public.rea_live_dispatch(u,l,rev,oid,'PLACE',b,'/api/v3/market/place-ask')->>'allowed')::boolean then raise exception 'BUY_SENT_TO_ASK';end if;
 if (public.rea_live_dispatch(u,l,rev,oid,'PLACE',b||'{"amt":2000}','/api/v3/market/place-bid')->>'allowed')::boolean then raise exception 'CHANGED_WIRE_AMOUNT_ALLOWED';end if;
 r=public.rea_live_dispatch(u,l,rev,oid,'PLACE',b,'/api/v3/market/place-bid');
 if not(r->>'allowed')::boolean then raise exception 'VALID_DISPATCH_NOT_RESERVED: %',r;end if;
 if not exists(select 1 from rea.live_orders where user_id=u and client_order_id=oid and status='SUBMITTING') then raise exception 'MISSING_PERSISTED_DISPATCH';end if;
 if (public.rea_live_dispatch(u,l,(r->>'revision')::bigint,oid,'PLACE',b,'/api/v3/market/place-bid')->>'allowed')::boolean then raise exception 'DUPLICATE_DISPATCH_ALLOWED';end if;
 perform public.rea_live_control(u,'emergency');
 if (public.rea_live_dispatch(u,l,(r->>'revision')::bigint,oid,'PLACE',b,'/api/v3/market/place-bid')->>'allowed')::boolean then raise exception 'EMERGENCY_NOT_FENCED';end if;
 perform public.rea_live_control(u,'resume');
 if (select state->>'kill' from rea.live_accounts where user_id=u)<>'ALL' then raise exception 'RESUME_CLEARED_EMERGENCY';end if;
 -- A 429 cooldown survives the worker releasing its execution lease.
 update rea.live_accounts set lease=l,lease_until=now()+interval '90 seconds' where user_id=u;
 select revision,state into rev,s from rea.live_accounts where user_id=u;
 r=public.rea_live_checkpoint(u,l,rev,s,(select preflight from rea.live_accounts where user_id=u),jsonb_build_object('at',t,'health','SAFE_MODE'),'[]','risk','BITKUB_HTTP_429');
 if not exists(select 1 from rea.live_accounts where user_id=u and cooldown_until>=now()+interval '30 seconds') then raise exception '429_NOT_PERSISTED';end if;
 perform public.rea_live_release(u,l);
 if (select count(*) from public.rea_live_claim('risk',u))<>0 then raise exception '429_RESTART_BYPASSED_COOLDOWN';end if;
end$$;
rollback;
select 'LIVE_POSTGRES_INTEGRITY_PASSED_NO_HTTP' as result;
