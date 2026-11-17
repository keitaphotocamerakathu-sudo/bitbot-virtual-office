create or replace function public.rea_view(p_uid uuid) returns jsonb
language sql security invoker set search_path='' as $$
 select jsonb_build_object('mode',mode,'enabled',enabled,'state',state,'latest',latest,'updatedAt',updated_at,'lastError',last_error,'revision',revision,
 'operations',jsonb_build_object('locked',operational_lock,'reasons',operational_reasons,
 'services',(select coalesce(jsonb_agg(jsonb_build_object('service',service,'status',status,'at',at,'detail',detail)),'[]') from rea.service_heartbeats),
 'riskAt',(select at_ms from rea.bot_heartbeats where user_id=p_uid and service='risk-watchdog'),
 'alerts',(select coalesce(jsonb_agg(x order by id desc),'[]') from(select id,reason,status,opened_at,resolved_at from rea.alerts where user_id=p_uid order by id desc limit 30)x)),
 'paperEvidence',(select jsonb_build_object('samples',count(*),'firstAt',min(at_ms),'lastAt',max(at_ms),'daysObserved',round((max(at_ms)-min(at_ms))::numeric/86400000,3),'maximumGapMs',max(gap),'minimum7DaysElapsed',coalesce(max(at_ms)-min(at_ms)>=604800000,false),'liveActivationAllowed',false) from(select at_ms,at_ms-lag(at_ms) over(order by at_ms) as gap from rea.equity_snapshots where user_id=p_uid)x),
 'curve',(select coalesce(jsonb_agg(x order by at_ms),'[]') from (select at_ms,equity from rea.equity_snapshots where user_id=p_uid order by at_ms desc limit 1440)x),
 'daily',(select coalesce(jsonb_agg(x order by day),'[]') from (select day,payload from rea.daily_pnl where user_id=p_uid order by day desc limit 366)x),
 'audit',(select coalesce(jsonb_agg(x order by id desc),'[]') from (select id,action,payload,created_at from rea.audit_logs where user_id=p_uid order by id desc limit 50)x))
 from rea.bot_settings where user_id=p_uid;
$$;


