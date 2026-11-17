-- PostgreSQL repetition bounds are at most 255; check key length separately.
begin;
create or replace function bitbot_private.codex_store_key(p_uid uuid,p_key text) returns uuid
language plpgsql security definer set search_path='' as $$declare sid uuid;begin
 if not exists(select 1 from rea.codex_settings where user_id=p_uid) or p_key is null or length(p_key) not between 23 and 503 or p_key!~'^sk-[A-Za-z0-9_-]+$' then raise exception 'INVALID_CODEX_KEY';end if;
 select secret_id into sid from rea.codex_settings where user_id=p_uid;
 if sid is null then select vault.create_secret(p_key,'rea-codex-'||p_uid::text,'REA owner-scoped OpenAI key') into sid;
 else perform vault.update_secret(sid,p_key);end if;
 return sid;
end$$;
commit;
