begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- A user may own one object and manage another without losing either membership.
alter table public.memberships drop constraint memberships_pkey;
alter table public.memberships add primary key(company_id,user_id);
create index memberships_user on public.memberships(user_id,created_at);

alter table public.companies alter column rules set default '{"minRestHours":12,"maxWeeklyHours":40,"restSeverity":"warning","hoursSeverity":"warning","allowMultiple":true,"restEnabled":false,"hoursEnabled":false}';
alter table public.companies add column access_status text not null default 'setup' check(access_status in ('setup','trial','active','expired'));
alter table public.companies add column trial_started_at timestamptz;
alter table public.companies add column trial_ends_at timestamptz;

create table public.positions (
 company_id uuid not null references public.companies(id) on delete cascade,
 name text not null check(char_length(name) between 1 and 40), primary key(company_id,name)
);
insert into public.positions select id,p from public.companies cross join unnest(array['Barista','Konobar','Menadžer']) p;
alter table public.employee_positions drop constraint employee_positions_position_check;
alter table public.staffing_requirements drop constraint staffing_requirements_position_check;
alter table public.assignments drop constraint assignments_position_check;
alter table public.employee_positions add foreign key(company_id,position) references public.positions(company_id,name);
alter table public.staffing_requirements add foreign key(company_id,position) references public.positions(company_id,name);
alter table public.assignments add foreign key(company_id,position) references public.positions(company_id,name);

alter table public.shift_templates add column days integer[] not null default array[0,1,2,3,4,5,6] check(days <@ array[0,1,2,3,4,5,6]);
alter table public.employees add column max_hours numeric check(max_hours between 1 and 168);
alter table public.employees add column time_availability jsonb not null default '[]' check(jsonb_typeof(time_availability)='array');
alter table public.assignments add column starts_at time;
alter table public.assignments add column ends_at time;
alter table public.assignments add constraint assignment_times_differ check(starts_at <> ends_at);
update public.assignments a set starts_at=t.starts_at,ends_at=t.ends_at from public.shift_templates t where t.company_id=a.company_id and t.id=a.template_id;
alter table public.schedules add column rules_snapshot jsonb;
alter table public.schedules add column requirements_snapshot jsonb;
alter table public.absences add column kind text not null default 'absence' check(kind in ('absence','unavailable','wish'));
create index absences_employee_period on public.absences(company_id,employee_id,starts_on,ends_on);
create index replacements_assignment on public.replacements(company_id,assignment_id,week);
create index assignments_employee on public.assignments(company_id,employee_id,week);
create index assignments_template on public.assignments(company_id,template_id);
create index employee_positions_position on public.employee_positions(company_id,position);
create index staffing_requirements_position on public.staffing_requirements(company_id,position);
create index companies_created on public.companies(created_at);

create table public.date_availability (
 company_id uuid not null, id uuid not null, employee_id text not null, day date not null,
 starts_at time not null, ends_at time not null check(ends_at>starts_at),
 primary key(company_id,id), foreign key(company_id,employee_id) references public.employees(company_id,id)
);
create index date_availability_employee on public.date_availability(company_id,employee_id,day);
create table public.published_schedules (
 company_id uuid not null, week date not null, version bigint not null, payload jsonb not null,
 published_at timestamptz not null default now(), primary key(company_id,week),
 foreign key(company_id) references public.companies(id) on delete cascade
);
create table public.save_receipts (
 company_id uuid not null references public.companies(id) on delete cascade,
 operation_id uuid not null, user_id uuid not null references auth.users(id), version bigint not null,
 payload_hash bytea not null, created_at timestamptz not null default now(), primary key(company_id,operation_id)
);
create index save_receipts_user on public.save_receipts(user_id);
create table public.manager_invitations (
 company_id uuid not null references public.companies(id) on delete cascade,
 id uuid primary key default gen_random_uuid(), token_hash bytea not null unique,
 email text not null, created_by uuid not null references auth.users(id),
 expires_at timestamptz not null default now()+interval '7 days', accepted_at timestamptz
);
create index manager_invitations_company on public.manager_invitations(company_id);
create index manager_invitations_creator on public.manager_invitations(created_by);
create table public.notification_reads (
 company_id uuid not null references public.companies(id) on delete cascade,
 notification_id uuid not null references public.notifications(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 primary key(company_id,notification_id,user_id)
);
create index notification_reads_user on public.notification_reads(user_id);

do $$ declare t text; begin
 foreach t in array array['positions','date_availability','published_schedules','save_receipts','manager_invitations','notification_reads'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
 end loop;
 foreach t in array array['positions','date_availability','published_schedules'] loop
  execute format('grant select on public.%I to authenticated',t);
  execute format('create policy tenant_read on public.%I for select to authenticated using(public.is_member(company_id))',t);
 end loop;
end $$;

-- Internal helpers have no public RPC endpoint. Public wrappers check the caller explicitly.
create function private.shiftflow_projection(p_company uuid,p_week date) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('name',c.name,'schedule',jsonb_build_object('week',s.week,'status','published','assignments',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'employeeId',a.employee_id,'day',a.weekday,'templateId',a.template_id,'position',a.position,'start',to_char(coalesce(a.starts_at,t.starts_at),'HH24:MI'),'end',to_char(coalesce(a.ends_at,t.ends_at),'HH24:MI')) order by a.weekday,coalesce(a.starts_at,t.starts_at),a.employee_id) from public.assignments a join public.shift_templates t on t.company_id=a.company_id and t.id=a.template_id where a.company_id=s.company_id and a.week=s.week),'[]'::jsonb)),
 'employees',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'name',e.name)) from public.employees e where e.company_id=s.company_id and exists(select 1 from public.assignments a where a.company_id=e.company_id and a.employee_id=e.id and a.week=s.week)),'[]'::jsonb),
 'templates',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'start',to_char(t.starts_at,'HH24:MI'),'end',to_char(t.ends_at,'HH24:MI'),'color',t.color)) from public.shift_templates t where t.company_id=s.company_id),'[]'::jsonb))
 from public.companies c join public.schedules s on s.company_id=c.id where c.id=p_company and s.week=p_week;
$$;
insert into public.published_schedules(company_id,week,version,payload) select company_id,week,version,private.shiftflow_projection(company_id,week) from public.schedules where status='published';

create function private.assert_basic_schedule(p_company uuid,p_week date) returns void language plpgsql set search_path='' as $$
declare rules jsonb; reqs jsonb;
begin
 select coalesce(s.rules_snapshot,c.rules),coalesce(s.requirements_snapshot,'[]') into rules,reqs from public.schedules s join public.companies c on c.id=s.company_id where s.company_id=p_company and s.week=p_week;
 if exists(select 1 from jsonb_array_elements(reqs) r where (r->>'count')::integer > (select count(*) from public.assignments a where a.company_id=p_company and a.week=p_week and a.weekday=(r->>'day')::integer and a.template_id=r->>'templateId' and a.position=r->>'position')) then raise exception 'UNFILLED_REQUIREMENTS'; end if;
 if exists(select 1 from public.assignments a join public.employees e on e.company_id=a.company_id and e.id=a.employee_id join public.shift_templates t on t.company_id=a.company_id and t.id=a.template_id where a.company_id=p_company and a.week=p_week and (not e.active or not exists(select 1 from public.employee_positions ep where ep.company_id=a.company_id and ep.employee_id=a.employee_id and ep.position=a.position) or not a.weekday=any(t.days))) then raise exception 'EMPLOYEE_UNAVAILABLE_OR_INELIGIBLE'; end if;
 if not (rules->>'allowMultiple')::boolean and exists(select 1 from public.assignments where company_id=p_company and week=p_week group by employee_id,weekday having count(*)>1) then raise exception 'MULTIPLE_SHIFTS_PROHIBITED'; end if;
 if exists(with timed as (
  select a.id,a.week,a.employee_id,(a.week+a.weekday)+coalesce(a.starts_at,t.starts_at) as starts,(a.week+a.weekday)+coalesce(a.ends_at,t.ends_at)+case when coalesce(a.ends_at,t.ends_at)<=coalesce(a.starts_at,t.starts_at) then interval '1 day' else interval '0' end as ends
  from public.assignments a join public.shift_templates t on t.company_id=a.company_id and t.id=a.template_id where a.company_id=p_company and a.week between p_week-7 and p_week+7
 ) select 1 from timed a join timed b on a.employee_id=b.employee_id and (a.week,a.id)<>(b.week,b.id) where a.week=p_week and ((a.starts<b.ends and b.starts<a.ends) or (coalesce((rules->>'restEnabled')::boolean,true) and rules->>'restSeverity'='block' and extract(epoch from greatest(a.starts-b.ends,b.starts-a.ends))/3600<(rules->>'minRestHours')::numeric))) then raise exception 'OVERLAP_OR_INSUFFICIENT_REST'; end if;
 if exists(with timed as (
  select a.employee_id,(a.week+a.weekday)+coalesce(a.starts_at,t.starts_at) as starts,(a.week+a.weekday)+coalesce(a.ends_at,t.ends_at)+case when coalesce(a.ends_at,t.ends_at)<=coalesce(a.starts_at,t.starts_at) then interval '1 day' else interval '0' end as ends
  from public.assignments a join public.shift_templates t on t.company_id=a.company_id and t.id=a.template_id where a.company_id=p_company and a.week between p_week-7 and p_week+7
 ) select 1 from timed a join public.employees e on e.company_id=p_company and e.id=a.employee_id where a.starts<p_week+7 and a.ends>p_week and rules->>'hoursSeverity'='block' and (e.max_hours is not null or coalesce((rules->>'hoursEnabled')::boolean,true)) group by e.id,e.max_hours having sum(extract(epoch from least(a.ends,(p_week+7)::timestamp)-greatest(a.starts,p_week::timestamp))/3600)>coalesce(e.max_hours,(rules->>'maxWeeklyHours')::numeric)) then raise exception 'WEEKLY_HOURS_EXCEEDED'; end if;
 if exists(select 1 from public.assignments a join public.shift_templates t on t.company_id=a.company_id and t.id=a.template_id join public.absences ab on ab.company_id=a.company_id and ab.employee_id=a.employee_id and ab.kind<>'wish' where a.company_id=p_company and a.week=p_week and (a.week+a.weekday)+coalesce(a.starts_at,t.starts_at)<(ab.ends_on+1)::timestamp and ab.starts_on::timestamp<(a.week+a.weekday)+coalesce(a.ends_at,t.ends_at)+case when coalesce(a.ends_at,t.ends_at)<=coalesce(a.starts_at,t.starts_at) then interval '1 day' else interval '0' end) then raise exception 'EMPLOYEE_ABSENT'; end if;
 -- Split overnight intervals at midnight and apply date-specific windows before recurring windows.
 if exists(with timed as (
  select a.employee_id,(a.week+a.weekday)+coalesce(a.starts_at,t.starts_at) as starts,(a.week+a.weekday)+coalesce(a.ends_at,t.ends_at)+case when coalesce(a.ends_at,t.ends_at)<=coalesce(a.starts_at,t.starts_at) then interval '1 day' else interval '0' end as ends
  from public.assignments a join public.shift_templates t on t.company_id=a.company_id and t.id=a.template_id where a.company_id=p_company and a.week=p_week
 ), segments as (select a.*,d::date as day,greatest(a.starts,d) as seg_start,least(a.ends,d+interval '1 day') as seg_end from timed a cross join lateral generate_series(date_trunc('day',a.starts),date_trunc('day',a.ends-interval '1 second'),interval '1 day') d)
 select 1 from segments s join public.employees e on e.company_id=p_company and e.id=s.employee_id where
 case when exists(select 1 from public.date_availability v where v.company_id=p_company and v.employee_id=e.id and v.day=s.day)
 then not exists(select 1 from public.date_availability v where v.company_id=p_company and v.employee_id=e.id and v.day=s.day and s.day+v.starts_at<=s.seg_start and s.day+v.ends_at>=s.seg_end)
 else exists(select 1 from public.availability v where v.company_id=p_company and v.employee_id=e.id and v.weekday=extract(isodow from s.day)::integer-1 and not v.available)
 or (exists(select 1 from jsonb_array_elements(e.time_availability) v where (v->>'day')::integer=extract(isodow from s.day)::integer-1) and not exists(select 1 from jsonb_array_elements(e.time_availability) v where (v->>'day')::integer=extract(isodow from s.day)::integer-1 and s.day+(v->>'start')::time<=s.seg_start and s.day+(v->>'end')::time>=s.seg_end)) end) then raise exception 'EMPLOYEE_OUTSIDE_AVAILABILITY'; end if;
end $$;

-- Keep the tested normalized reconciliation, but invoke validation after v2 fields are written.
alter function public.save_workspace(uuid,jsonb,bigint) rename to save_workspace_legacy;
do $$ declare definition text; begin
 select pg_get_functiondef('public.save_workspace_legacy(uuid,jsonb,bigint)'::regprocedure) into definition;
 definition := replace(definition,' or rules is distinct from requested_rules','');
 definition := replace(definition,'  for sched in select week from public.schedules where company_id=p_company and status=''published'' loop'||chr(10)||'    perform public.assert_publishable(p_company,sched.week);'||chr(10)||'  end loop;','');
 execute definition;
end $$;
revoke all on function public.save_workspace_legacy(uuid,jsonb,bigint) from public,anon,authenticated;

create function public.save_workspace_v2(p_company uuid,p_state jsonb,p_expected_version bigint,p_operation uuid) returns bigint language plpgsql security definer set search_path='' as $$
declare old_doc public.workspace_documents; body jsonb; item jsonb; sched record; shift jsonb; next_version bigint; receipt public.save_receipts; clean jsonb; p text; changed boolean;
begin
 if auth.uid() is null or not public.is_member(p_company) then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
 select * into old_doc from public.workspace_documents where company_id=p_company for update;
 select * into receipt from public.save_receipts where company_id=p_company and operation_id=p_operation;
 if found then
  if receipt.user_id<>auth.uid() or receipt.payload_hash<>sha256(convert_to(p_state::text,'UTF8')) then raise exception 'OPERATION_MISMATCH'; end if;
  return receipt.version;
 end if;
 if old_doc.version<>p_expected_version then raise exception 'VERSION_CONFLICT' using errcode='40001'; end if;
 if exists(select 1 from public.companies where id=p_company and (access_status='expired' or (access_status='trial' and trial_ends_at<=now()))) then raise exception 'TRIAL_EXPIRED'; end if;
 body:=p_state->'current';
 if p_operation is null or (p_state->>'schema') is distinct from '2' or jsonb_typeof(body) is distinct from 'object' or jsonb_typeof(body->'employees') is distinct from 'array' or jsonb_typeof(body->'templates') is distinct from 'array' or jsonb_typeof(body->'requirements') is distinct from 'array' or jsonb_typeof(body->'schedules') is distinct from 'object' or jsonb_typeof(body->'positions') is distinct from 'array' or jsonb_typeof(body->'rules'->'allowMultiple') is distinct from 'boolean' then raise exception 'INVALID_STATE'; end if;
 if (body->'rules'->>'minRestHours') is null or (body->'rules'->>'maxWeeklyHours') is null or (body->'rules'->>'restSeverity') is null or (body->'rules'->>'hoursSeverity') is null then raise exception 'INVALID_RULES'; end if;
 if jsonb_array_length(body->'employees')<>(select count(distinct e->>'id') from jsonb_array_elements(body->'employees') e) or jsonb_array_length(body->'templates')<>(select count(distinct e->>'id') from jsonb_array_elements(body->'templates') e) then raise exception 'DUPLICATE_IDS'; end if;
 for p in select value from jsonb_array_elements_text(body->'positions') loop insert into public.positions values(p_company,p) on conflict do nothing; end loop;
 for sched in select key,value from jsonb_each(body->'schedules') loop
  if sched.value->>'week' is distinct from sched.key or jsonb_typeof(sched.value->'assignments') is distinct from 'array' then raise exception 'INVALID_SCHEDULE'; end if;
  if jsonb_array_length(sched.value->'assignments')<>(select count(distinct a->>'id') from jsonb_array_elements(sched.value->'assignments') a) then raise exception 'DUPLICATE_ASSIGNMENT_IDS'; end if;
 end loop;
 clean:=jsonb_build_object('schema',1,'revision',p_state->'revision','current',body,'past','[]'::jsonb,'future','[]'::jsonb);
 next_version:=public.save_workspace_legacy(p_company,clean,p_expected_version);
 for item in select value from jsonb_array_elements(body->'employees') loop
  update public.employees set max_hours=nullif(item->>'maxHours','')::numeric,time_availability=coalesce(item->'availability','[]') where company_id=p_company and id=item->>'id';
 end loop;
 for item in select value from jsonb_array_elements(body->'templates') loop
  update public.shift_templates set days=coalesce((select array_agg(value::integer) from jsonb_array_elements_text(item->'days')),array[0,1,2,3,4,5,6]) where company_id=p_company and id=item->>'id';
 end loop;
 delete from public.absences where company_id=p_company;
 for item in select value from jsonb_array_elements(coalesce(body->'absences','[]')) loop
  insert into public.absences(company_id,id,employee_id,starts_on,ends_on,reason,kind) values(p_company,(item->>'id')::uuid,item->>'employeeId',(item->>'from')::date,(item->>'to')::date,coalesce(item->>'reason',''),item->>'kind');
 end loop;
 delete from public.date_availability where company_id=p_company;
 for item in select value from jsonb_array_elements(coalesce(body->'dateAvailability','[]')) loop
  insert into public.date_availability values(p_company,(item->>'id')::uuid,item->>'employeeId',(item->>'date')::date,(item->>'start')::time,(item->>'end')::time);
 end loop;
 for sched in select key,value from jsonb_each(body->'schedules') loop
  changed := (old_doc.state#>array['current','schedules',sched.key]) is distinct from sched.value;
  update public.schedules set rules_snapshot=case when changed and sched.value->>'status'='published' then body->'rules' else coalesce(sched.value->'rules',body->'rules') end,requirements_snapshot=coalesce(sched.value->'requirements',body->'requirements') where company_id=p_company and week=sched.key::date;
  for shift in select value from jsonb_array_elements(sched.value->'assignments') loop
   update public.assignments a set starts_at=coalesce(nullif(shift->>'start','')::time,t.starts_at),ends_at=coalesce(nullif(shift->>'end','')::time,t.ends_at) from public.shift_templates t where a.company_id=p_company and a.week=sched.key::date and a.id=shift->>'id' and t.company_id=a.company_id and t.id=a.template_id;
  end loop;
  if changed and sched.value->>'status'='published' then
   perform private.assert_basic_schedule(p_company,sched.key::date);
   insert into public.published_schedules(company_id,week,version,payload) values(p_company,sched.key::date,next_version,private.shiftflow_projection(p_company,sched.key::date)) on conflict(company_id,week) do update set version=excluded.version,payload=excluded.payload,published_at=now();
  end if;
 end loop;
 for item in select value from jsonb_array_elements(coalesce(body->'replacements','[]')) loop
  if exists(select 1 from public.assignments where company_id=p_company and week=(item->>'week')::date and id=item->>'assignmentId') then
   insert into public.replacements(company_id,id,week,assignment_id,original_employee_id,replacement_employee_id,note) values(p_company,(item->>'id')::uuid,(item->>'week')::date,item->>'assignmentId',item->>'originalEmployeeId',item->>'replacementEmployeeId',coalesce(item->>'note','')) on conflict(id) do nothing;
  end if;
 end loop;
 clean:=jsonb_build_object('schema',2,'revision',p_state->'revision','current',body,'past','[]'::jsonb,'future','[]'::jsonb);
 update public.workspace_documents set state=clean where company_id=p_company;
 update public.change_history set previous_state=old_doc.state-'past'-'future',next_state=clean where company_id=p_company and version=next_version;
 insert into public.save_receipts values(p_company,p_operation,auth.uid(),next_version,sha256(convert_to(p_state::text,'UTF8')),now());
 return next_version;
end $$;

create or replace function public.read_shared_schedule(p_token text) returns jsonb language sql stable security definer set search_path='' as $$
 select p.payload||jsonb_build_object('version',p.version,'publishedAt',p.published_at) from public.schedule_links l join public.published_schedules p on p.company_id=l.company_id and p.week=l.week where length(p_token)=64 and l.token_hash=sha256(convert_to(p_token,'UTF8')) and l.expires_at>now();
$$;
create or replace function public.rotate_schedule_link(p_company uuid,p_week date) returns text language plpgsql security definer set search_path='' as $$
declare token text;
begin
 if auth.uid() is null or not public.is_member(p_company) then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
 if not exists(select 1 from public.published_schedules where company_id=p_company and week=p_week) then raise exception 'SCHEDULE_NOT_PUBLISHED'; end if;
 token:=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');
 insert into public.schedule_links values(p_company,p_week,sha256(convert_to(token,'UTF8')),now()+interval '60 days',auth.uid()) on conflict(company_id,week) do update set token_hash=excluded.token_hash,expires_at=excluded.expires_at,created_by=excluded.created_by;
 return token;
end $$;

create function public.create_manager_invitation(p_company uuid,p_email text) returns text language plpgsql security definer set search_path='' as $$
declare token text;
begin
 if not public.is_owner(p_company) then raise exception 'OWNER_REQUIRED' using errcode='42501'; end if;
 if p_email is null or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'INVALID_EMAIL'; end if;
 token:=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');
 insert into public.manager_invitations(company_id,token_hash,email,created_by) values(p_company,sha256(convert_to(token,'UTF8')),lower(trim(p_email)),auth.uid());
 return token;
end $$;
create function public.accept_manager_invitation(p_token text) returns uuid language plpgsql security definer set search_path='' as $$
declare invitation public.manager_invitations; user_email text;
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
 select email into user_email from auth.users where id=auth.uid() and email_confirmed_at is not null;
 select * into invitation from public.manager_invitations where token_hash=sha256(convert_to(p_token,'UTF8')) and expires_at>now() and accepted_at is null for update;
 if not found or lower(user_email) is distinct from invitation.email then raise exception 'INVALID_INVITATION'; end if;
 insert into public.memberships(user_id,company_id,role) values(auth.uid(),invitation.company_id,'manager') on conflict(company_id,user_id) do nothing;
 update public.manager_invitations set accepted_at=now() where id=invitation.id;
 return invitation.company_id;
end $$;
create function public.remove_manager(p_company uuid,p_user uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.is_owner(p_company) then raise exception 'OWNER_REQUIRED' using errcode='42501'; end if;
 delete from public.memberships where company_id=p_company and user_id=p_user and role='manager';
end $$;
create function public.start_basic_trial(p_company uuid) returns timestamptz language plpgsql security definer set search_path='' as $$
declare ending timestamptz;
begin
 if not public.is_owner(p_company) then raise exception 'OWNER_REQUIRED' using errcode='42501'; end if;
 if not exists(select 1 from public.employees where company_id=p_company and active) or not exists(select 1 from public.staffing_requirements where company_id=p_company and required_count>0) then raise exception 'SETUP_INCOMPLETE'; end if;
 update public.companies set access_status='trial',trial_started_at=now(),trial_ends_at=now()+interval '21 days' where id=p_company and trial_started_at is null and access_status='setup' returning trial_ends_at into ending;
 if ending is null then select trial_ends_at into ending from public.companies where id=p_company; end if;
 return ending;
end $$;
create function public.mark_notification_read(p_company uuid,p_notification uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.is_member(p_company) or not exists(select 1 from public.notifications where company_id=p_company and id=p_notification) then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
 insert into public.notification_reads values(p_company,p_notification,auth.uid()) on conflict do nothing;
end $$;
grant select on public.notification_reads to authenticated;
create policy own_reads on public.notification_reads for select to authenticated using(user_id=(select auth.uid()) and public.is_member(company_id));

revoke all on all functions in schema private from public,anon,authenticated;
revoke all on function public.save_workspace_v2(uuid,jsonb,bigint,uuid),public.create_manager_invitation(uuid,text),public.accept_manager_invitation(text),public.remove_manager(uuid,uuid),public.start_basic_trial(uuid),public.mark_notification_read(uuid,uuid) from public,anon,authenticated;
grant execute on function public.save_workspace_v2(uuid,jsonb,bigint,uuid),public.create_manager_invitation(uuid,text),public.accept_manager_invitation(text),public.remove_manager(uuid,uuid),public.start_basic_trial(uuid),public.mark_notification_read(uuid,uuid) to authenticated;
-- Disable the old endpoint so stale clients cannot bypass v2 invariants.
revoke all on function public.add_manager(uuid,uuid) from public,anon,authenticated;

-- Existing Auth accounts created before these migrations get an empty owned workspace.
do $$ declare usr record; cid uuid; begin
 for usr in select id,raw_user_meta_data from auth.users u where not exists(select 1 from public.memberships m where m.user_id=u.id) loop
  insert into public.companies(name) values(left(coalesce(nullif(trim(usr.raw_user_meta_data->>'company_name'),''),'Moj kafić'),80)) returning id into cid;
  insert into public.memberships(user_id,company_id,role) values(usr.id,cid,'owner');
  insert into public.workspace_documents(company_id) values(cid);
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
