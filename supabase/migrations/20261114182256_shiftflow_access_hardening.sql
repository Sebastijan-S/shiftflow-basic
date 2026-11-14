begin;

-- Only invoker wrappers are exposed through the Data API. Privileged implementations
-- remain in a non-exposed schema with exact grants and their existing membership checks.
grant usage on schema private to authenticated,anon;
do $$ declare f record; definition text; roles text; begin
 for f in select * from (values
  ('is_member','uuid','p_company uuid','p_company','boolean',false),
  ('is_owner','uuid','p_company uuid','p_company','boolean',false),
  ('save_workspace_v2','uuid,jsonb,bigint,uuid','p_company uuid,p_state jsonb,p_expected_version bigint,p_operation uuid','p_company,p_state,p_expected_version,p_operation','bigint',false),
  ('create_manager_invitation','uuid,text','p_company uuid,p_email text','p_company,p_email','text',false),
  ('accept_manager_invitation','text','p_token text','p_token','uuid',false),
  ('remove_manager','uuid,uuid','p_company uuid,p_user uuid','p_company,p_user','void',false),
  ('start_basic_trial','uuid','p_company uuid','p_company','timestamptz',false),
  ('mark_notification_read','uuid,uuid','p_company uuid,p_notification uuid','p_company,p_notification','void',false),
  ('read_shared_schedule','text','p_token text','p_token','jsonb',true),
  ('rotate_schedule_link','uuid,date','p_company uuid,p_week date','p_company,p_week','text',false),
  ('revoke_schedule_link','uuid,date','p_company uuid,p_week date','p_company,p_week','void',false)
 ) x(name,types,parameters,arguments,result,anonymous) loop
  execute format('alter function public.%I(%s) set schema private',f.name,f.types);
  execute format('revoke all on function private.%I(%s) from public,anon,authenticated',f.name,f.types);
  roles:=case when f.anonymous then 'anon,authenticated' else 'authenticated' end;
  execute format('grant execute on function private.%I(%s) to %s',f.name,f.types,roles);
  execute format('create function public.%I(%s) returns %s language sql security invoker set search_path='''' as $wrapper$ select private.%I(%s) $wrapper$',f.name,f.parameters,f.result,f.name,f.arguments);
  execute format('revoke all on function public.%I(%s) from public,anon,authenticated',f.name,f.types);
  execute format('grant execute on function public.%I(%s) to %s',f.name,f.types,roles);
 end loop;
 alter function public.save_workspace_legacy(uuid,jsonb,bigint) set schema private;
 alter function public.bootstrap_company() set schema private;
 alter function public.assert_publishable(uuid,date) set schema private;
 alter function public.add_manager(uuid,uuid) set schema private;
 select pg_get_functiondef('private.save_workspace_v2(uuid,jsonb,bigint,uuid)'::regprocedure) into definition;
 execute replace(definition,'public.save_workspace_legacy(','private.save_workspace_legacy(');
end $$;
revoke all on function private.save_workspace_legacy(uuid,jsonb,bigint),private.bootstrap_company(),private.assert_publishable(uuid,date),private.add_manager(uuid,uuid) from public,anon,authenticated;
create policy no_direct_access on public.save_receipts for all to authenticated using(false) with check(false);
create policy no_direct_access on public.manager_invitations for all to authenticated using(false) with check(false);

-- An invited account does not create an unrelated company during signup.
create or replace function private.bootstrap_company() returns trigger language plpgsql security definer set search_path='' as $$
declare cid uuid; company_name text;
begin
 company_name:=left(nullif(trim(new.raw_user_meta_data->>'company_name'),''),80);
 if company_name is null then return new; end if;
 insert into public.companies(name) values(company_name) returning id into cid;
 insert into public.memberships(user_id,company_id,role) values(new.id,cid,'owner');
 insert into public.workspace_documents(company_id) values(cid);
 return new;
end $$;

-- A confirmed user with no object can finish owner onboarding after email confirmation.
create function private.create_basic_company(p_name text) returns uuid language plpgsql security definer set search_path='' as $$
declare cid uuid;
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
 if length(trim(p_name)) not between 1 and 80 then raise exception 'INVALID_NAME'; end if;
 insert into public.companies(name) values(trim(p_name)) returning id into cid;
 insert into public.memberships(user_id,company_id,role) values(auth.uid(),cid,'owner');
 insert into public.workspace_documents(company_id) values(cid);
 return cid;
end $$;
revoke all on function private.create_basic_company(text) from public,anon,authenticated;
grant execute on function private.create_basic_company(text) to authenticated;
create function public.create_basic_company(p_name text) returns uuid language sql security invoker set search_path='' as $$ select private.create_basic_company(p_name) $$;
revoke all on function public.create_basic_company(text) from public,anon,authenticated;
grant execute on function public.create_basic_company(text) to authenticated;
notify pgrst,'reload schema';
commit;
