-- An independent public price receipt for Bangkok midnight. No execution or balance permissions.
create table rea.paper_boundary_requests (
 trading_day date primary key,requested_at timestamptz not null,request_id bigint not null unique,
 received_at timestamptz,status text not null check(status in ('REQUESTED','OBSERVED','UNAVAILABLE')),
 quotes jsonb not null default '{}'::jsonb
);
create table rea.paper_boundary_inventories (
 user_id uuid not null references rea.bot_settings(user_id),trading_day date not null references rea.paper_boundary_requests,
 book text not null check(book in ('PARENT','MASTER')),book_day date,cash numeric not null,fee_rate numeric not null,
 positions jsonb not null,ledger_at bigint,primary key(user_id,trading_day,book)
);
create index rea_paper_boundary_inventories_day on rea.paper_boundary_inventories(trading_day);
alter table rea.paper_boundary_requests enable row level security;
alter table rea.paper_boundary_inventories enable row level security;
revoke all on rea.paper_boundary_requests,rea.paper_boundary_inventories from public,anon,authenticated,service_role;
grant select on rea.paper_boundary_requests,rea.paper_boundary_inventories to service_role;
create policy service_read on rea.paper_boundary_requests for select to service_role using(true);
create policy service_read on rea.paper_boundary_inventories for select to service_role using(true);

create function rea.paper_request_boundary() returns text language plpgsql security invoker set search_path='' as $$
declare stamp timestamptz=clock_timestamp(); trading_date date=(stamp at time zone 'Asia/Bangkok')::date;
 boundary timestamptz=trading_date::timestamp at time zone 'Asia/Bangkok'; request_id bigint;
begin
 if stamp<boundary or stamp>boundary+interval '20 seconds' then return 'OUTSIDE_BOUNDARY'; end if;
 if not pg_try_advisory_xact_lock(73921302) or exists(select 1 from rea.paper_boundary_requests where trading_day=trading_date) then return 'ALREADY_REQUESTED'; end if;
 if not exists(select 1 from rea.bot_settings where enabled and mode='PAPER_ONLY') then return 'IDLE'; end if;
 request_id=net.http_get(url:='https://api.bitkub.com/api/v3/market/ticker',
   headers:='{"Accept":"application/json","Cache-Control":"no-cache"}'::jsonb,timeout_milliseconds:=8000);
 insert into rea.paper_boundary_requests(trading_day,requested_at,request_id,status) values(trading_date,stamp,request_id,'REQUESTED');
 -- Store only inventory and the fee convention. A pre-existing ledger gap remains visible.
 insert into rea.paper_boundary_inventories(user_id,trading_day,book,book_day,cash,fee_rate,positions,ledger_at)
 select user_id,trading_date,book,(state->>'day')::date,(state->>'cash')::numeric,fee_rate,
   (select coalesce(jsonb_agg(jsonb_build_object('symbol',p->>'symbol','qty',p->'qty') order by p->>'symbol'),'[]'::jsonb)
    from jsonb_array_elements(state->'positions') p),(state->>'lastAt')::bigint
 from (select user_id,'PARENT' as book,state,0.0025::numeric as fee_rate from rea.bot_settings where enabled and mode='PAPER_ONLY'
    union all select m.user_id,'MASTER',m.state,(m.config->>'fee')::numeric from rea.master_books m
    join rea.bot_settings b using(user_id) where b.enabled and m.mode='PAPER_ONLY' and m.state is not null) books;
 return 'REQUESTED';
end $$;

create function rea.paper_boundary_quotes(p_body jsonb,p_symbols text[]) returns jsonb
language sql immutable security invoker set search_path='' as $$
 with tickers as (select q->>'symbol' as symbol,q->>'highest_bid' as bid,q->>'lowest_ask' as ask,q->>'last' as last
   from jsonb_array_elements(case when jsonb_typeof(p_body)='array' then p_body else '[]'::jsonb end) q
   where q->>'symbol'=any(p_symbols)),
 typed as (select symbol,case when bid ~ '^[0-9]{1,18}([.][0-9]{1,18})?$' then bid::numeric end as bid,
   case when ask ~ '^[0-9]{1,18}([.][0-9]{1,18})?$' then ask::numeric end as ask,
   case when last ~ '^[0-9]{1,18}([.][0-9]{1,18})?$' then last::numeric end as last from tickers),
 unique_tickers as (select symbol,min(bid) bid,min(ask) ask,min(last) last from typed group by symbol having count(*)=1)
 select coalesce(jsonb_object_agg(symbol,jsonb_build_object('bid',bid,'ask',ask,'last',last)),'{}'::jsonb)
 from unique_tickers where bid>0 and ask>=bid and last>0;
$$;

create or replace function rea.paper_collect_boundary() returns text language plpgsql security invoker set search_path='' as $$
declare trading_date date=(now() at time zone 'Asia/Bangkok')::date; req rea.paper_boundary_requests%rowtype;
 response net._http_response%rowtype; required_symbols text[]; captured_quotes jsonb='{}'; body jsonb;
begin
 select * into req from rea.paper_boundary_requests where trading_day=trading_date and status='REQUESTED' for update;
 if not found then return 'NO_PENDING_REQUEST'; end if;
 select * into response from net._http_response where id=req.request_id;
 if not found and now()<req.requested_at+interval '2 minutes' then return 'PENDING'; end if;
 select coalesce(array_agg(distinct p->>'symbol'),array[]::text[]) into required_symbols
   from rea.paper_boundary_inventories i cross join lateral jsonb_array_elements(i.positions) p where i.trading_day=trading_date;
 if response.status_code=200 and response.timed_out is false and response.error_msg is null
    and response.created between req.requested_at and req.requested_at+interval '10 seconds'
    and response.created<=((trading_date::timestamp at time zone 'Asia/Bangkok')+interval '30 seconds') then
  begin body=response.content::jsonb; exception when invalid_text_representation then body=null; end;
  captured_quotes=rea.paper_boundary_quotes(body,required_symbols);
 end if;
 update rea.paper_boundary_requests set received_at=response.created,quotes=captured_quotes,
   status=case when (case when jsonb_typeof(body)='array' then jsonb_array_length(body)>0 else false end) and captured_quotes ?& required_symbols then 'OBSERVED' else 'UNAVAILABLE' end
 where trading_day=trading_date;
 return (select status from rea.paper_boundary_requests where trading_day=trading_date);
end $$;

revoke all on function rea.paper_request_boundary(),rea.paper_collect_boundary(),rea.paper_boundary_quotes(jsonb,text[]) from public,anon,authenticated,service_role;
-- pg_cron runs on GMT in this deployment. The capture also enforces Bangkok midnight itself.
select cron.schedule('rea-paper-boundary-bangkok','0 17 * * *','select rea.paper_request_boundary()');
select cron.schedule('rea-paper-boundary-receipt','1-3 17 * * *','select rea.paper_collect_boundary()');
