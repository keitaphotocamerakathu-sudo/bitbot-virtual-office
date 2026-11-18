-- Append-only evidence from the shared-snapshot reviewers. No trading grants or controls.
begin;
create table rea.review_cycles(
 user_id uuid not null references rea.bot_settings(user_id),
 mode text not null check(mode in('LIVE','PAPER')),
 at_ms bigint not null check(at_ms>0),
 payload jsonb not null check(jsonb_typeof(payload)='object' and octet_length(payload::text)<=65536),
 created_at timestamptz not null default now(),
 primary key(user_id,mode,at_ms)
);
alter table rea.review_cycles enable row level security;
create policy service_only on rea.review_cycles for select to service_role using(true);
create policy service_insert on rea.review_cycles for insert to service_role with check(true);
revoke all on rea.review_cycles from public,anon,authenticated,service_role;
grant select,insert on rea.review_cycles to service_role;

create function rea.archive_review_cycle() returns trigger
language plpgsql security invoker set search_path='' as $$
declare receipt jsonb;stamp text;scope text;
begin
 receipt=new.latest->'team';
 if tg_op='UPDATE' and receipt is not distinct from old.latest->'team' then return new;end if;
 -- Invalid auxiliary evidence must not interrupt a risk checkpoint or a stop exit.
 if receipt is null or jsonb_typeof(receipt)<>'object' or octet_length(receipt::text)>65536 then return new;end if;
 if receipt->>'method' is distinct from 'DETERMINISTIC_SHARED_SNAPSHOT' or receipt->>'reviewers' is distinct from '7' then return new;end if;
 if jsonb_typeof(receipt->'reviews') is distinct from 'array' then return new;end if;
 if jsonb_array_length(receipt->'reviews')<>7 then return new;end if;
 stamp=receipt->>'at';
 if jsonb_typeof(receipt->'at') is distinct from 'number' or stamp is null or stamp!~'^[1-9][0-9]{0,14}$' then return new;end if;
 scope=case when tg_table_name='live_accounts' then 'LIVE' else 'PAPER' end;
 insert into rea.review_cycles(user_id,mode,at_ms,payload) values(new.user_id,scope,stamp::bigint,receipt)
 on conflict(user_id,mode,at_ms) do nothing;
 return new;
end$$;
revoke all on function rea.archive_review_cycle() from public,anon,authenticated;
grant execute on function rea.archive_review_cycle() to service_role;
create trigger archive_review_cycle after insert or update of latest on rea.live_accounts
 for each row execute function rea.archive_review_cycle();
create trigger archive_review_cycle after insert or update of latest on rea.bot_settings
 for each row execute function rea.archive_review_cycle();
commit;
