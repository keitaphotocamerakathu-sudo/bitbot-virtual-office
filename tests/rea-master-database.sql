-- Server role, synthetic accounts, all writes rolled back, no external calls.
begin;
insert into auth.users(id,aud,role,email) values('fa313131-3131-4131-8131-313131313131','authenticated','authenticated','rea-master-validation@example.invalid');
insert into rea.bot_settings(user_id,state) values('fa313131-3131-4131-8131-313131313131','{"mode":"PAPER_ONLY","initialCapital":10000,"cash":10000}');
insert into rea.live_accounts(user_id,state) values('fa313131-3131-4131-8131-313131313131','{"mode":"LIVE","cash":25,"buyPaused":true}');
set local role service_role;
do $$
declare u uuid='fa313131-3131-4131-8131-313131313131';l uuid=gen_random_uuid();t bigint=floor(extract(epoch from now())*1000)-15000;parent jsonb;book jsonb;latest jsonb;packet jsonb;loaded jsonb;c jsonb;bad jsonb;o jsonb;orders jsonb='[]';before_live jsonb;old_master jsonb;rev bigint;ret boolean;i integer;
begin
 if has_table_privilege('anon','rea.master_books','SELECT') or has_table_privilege('authenticated','rea.master_journal','SELECT') or has_function_privilege('authenticated','public.rea_master_configure(uuid,bigint,jsonb)','EXECUTE') then raise exception 'MASTER_OWNER_DATA_EXPOSED';end if;
 loaded=public.rea_master_state(u);c=loaded->'config';if not rea.valid_master_config(c) or loaded->>'mode'<>'PAPER_ONLY' or loaded->>'canActivateLive'<>'false' then raise exception 'INVALID_DEFAULT_MASTER_CONFIG';end if;
 select state into before_live from rea.live_accounts where user_id=u;
 parent=jsonb_build_object('version',1,'mode','PAPER_ONLY','initialCapital',10000,'cash',10000,'equity',10000,'dayStart',10000,'dayFlows',0,'dayPnl',0,'day',(now() at time zone 'Asia/Bangkok')::date::text,'positions','[]'::jsonb,'orders','[]'::jsonb,'fills','[]'::jsonb,'closed','[]'::jsonb,'days','{}'::jsonb,'fees',0,'realized',0,'seen','{}'::jsonb,'peak',10000,'maxDrawdown',0,'kill','NONE','dailyLocked',false,'buyPaused',false,'baselinePending',false,'lastAt',t);
 book=parent||jsonb_build_object('protocol','REA-MASTER-31.0.0','startedAt',t,'lastAt',t+15000,'stats',jsonb_build_object('closedTrades',0,'wins',0,'grossGains',0,'grossLosses',0),'strategyStats','{}'::jsonb,'validMinutes',1);
 for i in 1..3 loop o=jsonb_build_object('id','paper-order-'||i,'side','BUY','symbol',(array['BTC_THB','ETH_THB','XRP_THB'])[i],'status','OPEN','amount',1000,'remaining',1000,'limit',100,'stop',98,'target',106,'riskTHB',30,'createdAt',t,'quoteAt',t,'bookAt',t,'qtyScale',8,'minQuote',10,'strategyId','TREND_SHORT','strategyVersion','REA-MASTER-31.0.0','horizon','SHORT');orders=orders||jsonb_build_array(o);end loop;
 book=jsonb_set(book,'{orders}',orders);latest=jsonb_build_object('at',t+15000,'health','OK','mode','PAPER_ONLY','canTrade',false,'canActivateLive',false,'summary',jsonb_build_object('openRiskTHB',90));packet=jsonb_build_object('book',book,'latest',latest,'journal',jsonb_build_array(jsonb_build_object('id','decision-1','at',t,'type','DECISION','payload',jsonb_build_object('signal','BUY','simulation',true))));
 update rea.bot_settings set state=parent,revision=0,lease=l,lease_until=now()+interval '90 seconds' where user_id=u;
 if public.rea_master_checkpoint(u,gen_random_uuid(),0,parent,jsonb_build_object('at',t,'health','OK','quotes','[]'::jsonb),'[]','[]','[]',t,null,null,packet,0) then raise exception 'WRONG_LEASE_ACCEPTED';end if;
 bad=jsonb_set(packet,'{book,mode}','"LIVE"');begin perform public.rea_master_checkpoint(u,l,0,parent,jsonb_build_object('at',t,'health','OK','quotes','[]'::jsonb),'[]','[]','[]',t,null,null,bad,0);raise exception 'LIVE_LEDGER_ACCEPTED';exception when others then if sqlerrm<>'MASTER_PAPER_PROTOCOL_REQUIRED' then raise;end if;end;
 bad=jsonb_set(packet,'{book,orders,0,riskTHB}','1');begin perform public.rea_master_checkpoint(u,l,0,parent,jsonb_build_object('at',t,'health','OK','quotes','[]'::jsonb),'[]','[]','[]',t,null,null,bad,0);raise exception 'UNDERSTATED_RISK_ACCEPTED';exception when others then if sqlerrm<>'MASTER_COST_OR_RISK_PROOF_FAILED' then raise;end if;end;
 bad=jsonb_set(packet,'{latest,summary,openRiskTHB}','0');bad=jsonb_set(bad,'{book,orders}',(select jsonb_agg(jsonb_set(value,'{riskTHB}','100')) from jsonb_array_elements(orders)));bad=jsonb_set(bad,'{book,orders}',bad->'book'->'orders'||jsonb_build_array((orders->0)||'{"id":"extra-a","symbol":"ADA_THB","riskTHB":100}'::jsonb,(orders->0)||'{"id":"extra-b","symbol":"SOL_THB","riskTHB":100}'::jsonb));
 begin perform public.rea_master_checkpoint(u,l,0,parent,jsonb_build_object('at',t,'health','OK','quotes','[]'::jsonb),'[]','[]','[]',t,null,null,bad,0);raise exception 'FORGED_SUMMARY_BYPASSED_TOTAL_RISK';exception when others then if sqlerrm<>'MASTER_DRAWDOWN_OR_DAILY_LOCK' and sqlerrm<>'MASTER_PORTFOLIO_RISK_LIMIT' then raise;end if;end;
 bad=jsonb_set(packet,'{book,orders}',orders||jsonb_build_array((orders->0)||'{"id":"four","symbol":"ADA_THB"}'::jsonb,(orders->0)||'{"id":"five","symbol":"SOL_THB"}'::jsonb,(orders->0)||'{"id":"six","symbol":"KUB_THB"}'::jsonb));
 begin perform public.rea_master_checkpoint(u,l,0,parent,jsonb_build_object('at',t,'health','OK','quotes','[]'::jsonb),'[]','[]','[]',t,null,null,bad,0);raise exception 'SIX_POSITIONS_ACCEPTED';exception when others then if sqlerrm<>'MASTER_ABSOLUTE_POSITION_LIMIT' then raise;end if;end;
 bad=jsonb_set(packet,'{book,orders,0,quoteAt}',to_jsonb(t-31000));begin perform public.rea_master_checkpoint(u,l,0,parent,jsonb_build_object('at',t,'health','OK','quotes','[]'::jsonb),'[]','[]','[]',t,null,null,bad,0);raise exception 'STALE_EVIDENCE_ACCEPTED';exception when others then if sqlerrm<>'MASTER_ORDER_EVIDENCE_STALE' then raise;end if;end;
 bad=jsonb_set(packet,'{journal}',jsonb_build_array(jsonb_build_object('id','bad-fill','at',t,'type','FILL','payload',jsonb_build_object('simulation',false))));begin perform public.rea_master_checkpoint(u,l,0,parent,jsonb_build_object('at',t,'health','OK','quotes','[]'::jsonb),'[]','[]','[]',t,null,null,bad,0);raise exception 'REAL_FILL_IMPORTED_TO_PAPER';exception when others then if sqlerrm<>'INVALID_MASTER_JOURNAL' then raise;end if;end;
 if (select revision from rea.bot_settings where user_id=u)<>0 or (select state from rea.master_books where user_id=u) is not null then raise exception 'FAILED_CHECKPOINT_NOT_ATOMIC';end if;
 ret=public.rea_master_checkpoint(u,l,0,parent,jsonb_build_object('at',t,'health','OK','quotes','[]'::jsonb),'[]','[]','[]',t,null,null,packet,0);if not ret then raise exception 'VALID_MASTER_CHECKPOINT_FAILED';end if;
 if (select revision from rea.bot_settings where user_id=u)<>1 or (select count(*) from rea.master_journal where user_id=u)<>1 or (select count(*) from rea.master_equity where user_id=u)<>1 then raise exception 'MASTER_JOURNAL_OR_PARENT_NOT_COMMITTED';end if;
 if public.rea_master_checkpoint(u,l,0,parent,jsonb_build_object('at',t,'health','OK','quotes','[]'::jsonb),'[]','[]','[]',t,null,null,packet,0) then raise exception 'OLD_CHECKPOINT_REPLAYED';end if;
 -- Journal-only cost-basis fixture: cash/equity transitions are tested by the execution unit suite.
 update rea.bot_settings set lease=l,lease_until=now()+interval '90 seconds' where user_id=u;
 bad=jsonb_set(packet,'{book,lastAt}',to_jsonb(t+15001));bad=jsonb_set(bad,'{latest,at}',to_jsonb(t+15001));
 bad=jsonb_set(bad,'{journal}',jsonb_build_array(jsonb_build_object('id','cost-basis-buy','at',t+15001,'type','FILL','payload',jsonb_build_object('strategyId','TREND_SHORT','horizon','SHORT','positionId','cost-example','side','BUY','qty',2,'price',100,'fee',1,'simulation',true)),jsonb_build_object('id','cost-basis-sell','at',t+15001,'type','FILL','payload',jsonb_build_object('strategyId','TREND_SHORT','horizon','SHORT','positionId','cost-example','side','SELL','qty',1,'price',110,'fee',1,'realized',8.5,'simulation',true))));
 if not public.rea_master_checkpoint(u,l,1,parent,jsonb_build_object('at',t,'health','OK','quotes','[]'::jsonb),'[]','[]','[]',t,null,null,bad,0) then raise exception 'COST_BASIS_CHECKPOINT_FAILED';end if;
 select payload into o from rea.master_journal where user_id=u and event_id='cost-basis-sell';
 if (o->>'grossPnlTHB')::numeric<>10 or (o->>'netPnlTHB')::numeric<>8.5 or (o->>'allocatedEntryFeeTHB')::numeric<>.5 or (o->>'settlementAndRoundingResidualTHB')::numeric<>0 then raise exception 'GROSS_NET_FEES_BASIS_MISMATCH';end if;
 insert into rea.master_journal values(u,'closed-cost-example',t+15001,'CLOSED',jsonb_build_object('strategyId','TREND_SHORT','horizon','SHORT','pnl',8.5,'simulation',true));
 o=public.rea_master_view(u)->'performance'->0;
 if (o->>'net_pnl')::numeric<>8.5 or (o->>'fees')::numeric<>2 or (o->>'closed_trades')::integer<>1 then raise exception 'FULL_HISTORY_PERFORMANCE_COST_VIEW_MISMATCH';end if;

 bad=c||'{"mode":"LIVE_ENABLED"}'::jsonb;begin perform public.rea_master_configure(u,0,bad);raise exception 'CONFIG_ENABLED_REAL_TRADES';exception when others then if sqlerrm<>'INVALID_MASTER_PAPER_CONFIG' then raise;end if;end;
 bad=c||'{"riskPerTrade":0.02}'::jsonb;begin perform public.rea_master_configure(u,0,bad);raise exception 'CONFIG_RAISED_RISK';exception when others then if sqlerrm<>'INVALID_MASTER_PAPER_CONFIG' then raise;end if;end;
 perform public.rea_master_configure(u,0,c||'{"buyPaused":true}'::jsonb);if (select config_revision from rea.master_books where user_id=u)<>1 or (select lease from rea.bot_settings where user_id=u) is not null then raise exception 'CONFIG_DID_NOT_INVALIDATE_WORKER';end if;
 begin perform public.rea_master_configure(u,0,c);raise exception 'CONCURRENT_CONFIG_OVERWRITE';exception when others then if sqlerrm<>'MASTER_CONFIG_REVISION_CHANGED' then raise;end if;end;
 if (select state from rea.live_accounts where user_id=u) is distinct from before_live then raise exception 'MASTER_CHANGED_LIVE_STATE';end if;
 if (select count(*) from rea.live_orders where user_id=u)<>0 or (select count(*) from rea.live_fills where user_id=u)<>0 then raise exception 'MASTER_CREATED_REAL_ORDERS';end if;
 if (select count(*) from rea.audit_logs where user_id=u and action='MASTER_PAPER_CONFIG_CHANGED')<>1 then raise exception 'CONFIG_NOT_AUDITED';end if;
end;$$;
reset role;
rollback;
select 'MASTER_PAPER_RISK_PRECISION_SLOTS_ROLES_LEASE_CONFIG_ATOMICITY_JOURNAL_NO_LIVE_WRITES_PASSED_ROLLED_BACK' as result;
