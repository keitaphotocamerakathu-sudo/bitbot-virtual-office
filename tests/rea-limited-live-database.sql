-- All owner, wallet and market fixtures roll back. No HTTP or exchange writes.
begin;
do $$declare u uuid;l uuid=gen_random_uuid();oid uuid=gen_random_uuid();s jsonb;o jsonb;r jsonb;b jsonb;n text;t bigint=floor(extract(epoch from now())*1000);rev bigint;begin
 select user_id into u from rea.live_accounts limit 1;if u is null then raise exception 'LIVE_ACCOUNT_REQUIRED';end if;
 update rea.live_accounts set mode='LIVE_LOCKED',state=null,approval=null,lease=null,lease_until=null,cooldown_until=null,preflight=jsonb_build_object('ok',true,'at',t,'keyFingerprint','TEST_ONLY_LIMITED','wallet',jsonb_build_object('THB',jsonb_build_object('available',99.97,'reserved',0))) where user_id=u;
 foreach n in array array['EXECUTION_TESTS','RECOVERY_TESTS'] loop
  insert into rea.live_checks(user_id,check_name,passed,spec,evidence) values(u,n,true,'REA-LIVE-19.0','{"testOnly":true}') on conflict(user_id,check_name) do update set passed=true,spec=excluded.spec,expires_at=null,evidence=excluded.evidence;
 end loop;
 insert into rea.live_checks(user_id,check_name,passed,spec,evidence) values(u,'LIMITED_CAPITAL_TESTS',true,'REA-LIMITED-19.1','{"testOnly":true}') on conflict(user_id,check_name) do update set passed=true,spec=excluded.spec,expires_at=null,evidence=excluded.evidence;
 perform public.rea_live_heartbeat(u,'risk','OK',t);
 r=public.rea_live_ready(u);
 if (r->>'ready')::boolean or not(r->'limited'->>'ready')::boolean then raise exception 'LIMITED_AND_FULL_READINESS_NOT_SEPARATE: %',r;end if;
 s=jsonb_build_object('version',1,'mode','LIVE','policy','OWNER_LIMITED_LIVE','accounting','EXCHANGE_RECEIPTS','initialCapital',10000,'allocatedCapital',99.97,'cash',99.97,'equity',99.97,'dayStart',99.97,'dayPnl',0,'dayFlows',0,'day',(now() at time zone 'Asia/Bangkok')::date::text,'dailyLocked',false,'baselinePending',false,'buyPaused',false,'kill','NONE','positions','[]'::jsonb,'orders','[]'::jsonb,'fills','[]'::jsonb,'closed','[]'::jsonb,'days','{}'::jsonb,'seen','{}'::jsonb,'realized',0,'fees',0,'peak',99.97,'maxDrawdown',0);
 begin
  perform public.rea_live_control(u,'activate','เปิดซื้อขายจริง Bitkub',s);
  raise exception 'MISSING_ACK_WAS_ACCEPTED';
 exception when others then if sqlerrm<>'LIMITED_OWNER_ACKNOWLEDGEMENT_REQUIRED' then raise;end if;end;
 s=s||'{"ownerAcknowledgement":{"acceptIncomplete":true,"acceptRisk":true,"noWithdraw":true}}';
 begin
  perform public.rea_live_control(u,'activate','เปิดซื้อขายจริง Bitkub',s||'{"cash":100.01,"allocatedCapital":100.01}');
  raise exception 'EXCESS_CAPITAL_WAS_ACCEPTED';
 exception when others then if sqlerrm<>'INVALID_INITIAL_LIVE_STATE' then raise;end if;end;
 r=public.rea_live_control(u,'activate','เปิดซื้อขายจริง Bitkub',s);
 if not(r->>'activated')::boolean then raise exception 'VALID_LIMITED_ACTIVATION_FAILED';end if;
 if not exists(select 1 from rea.live_accounts where user_id=u and approval->>'owner'=u::text and approval->>'capital'='99.97' and approval->>'keyFingerprint'='TEST_ONLY_LIMITED' and approval->>'launchSpec'='REA-LIMITED-19.1') then raise exception 'MISSING_BOUND_OWNER_APPROVAL';end if;
 update rea.live_accounts set lease=l,lease_until=now()+interval '90 seconds',latest=jsonb_build_object('at',t,'health','OK') where user_id=u returning revision into rev;
 begin
  perform public.rea_live_checkpoint(u,l,rev,s||'{"allocatedCapital":100}',(select preflight from rea.live_accounts where user_id=u),jsonb_build_object('at',t,'health','OK'),'[]','strategy',null);
  raise exception 'ALLOCATION_MUTATION_WAS_ACCEPTED';
 exception when others then if sqlerrm<>'LIVE_APPROVED_ALLOCATION_IMMUTABLE' then raise;end if;end;
 o=jsonb_build_object('id',oid,'clientId','rea19-limited-sql-only','symbol','BTC_THB','side','BUY','type','limit','limit',100,'amount',32,'remaining',32,'executed',0,'modeledLoss',.97,'riskFraction',.027,'status','RESERVED','createdAt',t,'quoteAt',t,'qtyScale',8,'stop',98,'target',104,'appliedTxnIds','[]'::jsonb);
 r=public.rea_live_checkpoint(u,l,rev,jsonb_set(s,'{orders}',jsonb_build_array(o)),(select preflight from rea.live_accounts where user_id=u),jsonb_build_object('at',t,'health','OK'),'[]','strategy',null);rev=(r->>'revision')::bigint;
 b=jsonb_build_object('sym','btc_thb','amt',32,'rat',100,'typ','limit','client_id','rea19-limited-sql-only');
 -- Independently enforce the floor of 1% of 99.97, even if an erroneous worker writes 1.00.
 update rea.live_accounts set state=jsonb_set(state,'{orders,0,modeledLoss}','1.00') where user_id=u;
 begin
  perform public.rea_live_dispatch(u,l,rev,oid,'PLACE',b,'/api/v3/market/place-bid');raise exception 'ONE_BAHT_RISK_ACCEPTED';
 exception when others then if sqlerrm<>'LIVE_RISK_BUDGET_EXCEEDED' then raise;end if;end;
 update rea.live_accounts set state=jsonb_set(state,'{orders,0,modeledLoss}','0.97') where user_id=u;
 -- A same-symbol holding plus a pending buy must fit the 39.98 position ceiling.
 update rea.live_accounts set state=jsonb_set(state,'{positions}','[{"symbol":"BTC_THB","qty":0.1,"cost":10,"stop":98,"target":104}]') where user_id=u;
 begin
  perform public.rea_live_dispatch(u,l,rev,oid,'PLACE',b,'/api/v3/market/place-bid');raise exception 'POSITION_CAP_BYPASSED';
 exception when others then if sqlerrm<>'LIMITED_POSITION_CAP_EXCEEDED' then raise;end if;end;
 update rea.live_accounts set state=jsonb_set(state,'{positions}','[]') where user_id=u;
 if (public.rea_live_dispatch(u,l,rev,oid,'PLACE',b,'/api/v3/market/place-ask')->>'allowed')::boolean then raise exception 'BUY_SENT_TO_ASK';end if;
 r=public.rea_live_dispatch(u,l,rev,oid,'PLACE',b,'/api/v3/market/place-bid');
 if not(r->>'allowed')::boolean then raise exception 'VALID_SMALL_DISPATCH_REJECTED: %',r;end if;
 if (public.rea_live_dispatch(u,l,(r->>'revision')::bigint,oid,'PLACE',b,'/api/v3/market/place-bid')->>'allowed')::boolean then raise exception 'DUPLICATE_SMALL_DISPATCH';end if;
 if (public.rea_live_ready(u)->>'ready')::boolean then raise exception 'FULL_ACCEPTANCE_WAS_FABRICATED';end if;
end$$;
rollback;
select 'LIMITED_LIVE_POSTGRES_INTEGRITY_PASSED_NO_HTTP' as result;
