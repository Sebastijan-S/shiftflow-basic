begin;
create function private.notify_basic_publication() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.payload is distinct from new.payload then insert into public.notifications(company_id,message) values(new.company_id,'Izmenjen je objavljeni raspored za nedelju od '||new.week||'.'); end if;
 return new;
end $$;
create trigger basic_publication_updated after update on public.published_schedules for each row execute function private.notify_basic_publication();
create function private.notify_basic_trial() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.access_status is distinct from new.access_status then
  insert into public.notifications(company_id,message) values(new.id,case new.access_status when 'trial' then 'Pokrenut je probni period od 21 dan.' when 'active' then 'Basic korišćenje je aktivirano.' when 'expired' then 'Probni period je istekao. Podaci ostaju dostupni za pregled i izvoz.' else 'Priprema objekta je otvorena.' end);
 end if;
 return new;
end $$;
create trigger basic_trial_updated after update of access_status on public.companies for each row execute function private.notify_basic_trial();
revoke all on function private.notify_basic_publication(),private.notify_basic_trial() from public,anon,authenticated;

create function private.get_basic_members(p_company uuid) returns table(user_id uuid,email text,role text) language plpgsql security definer set search_path='' as $$
begin
 if not public.is_member(p_company) then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;
 return query select m.user_id,u.email::text,m.role from public.memberships m join auth.users u on u.id=m.user_id where m.company_id=p_company order by m.created_at;
end $$;
revoke all on function private.get_basic_members(uuid) from public,anon,authenticated;
grant execute on function private.get_basic_members(uuid) to authenticated;
create function public.get_basic_members(p_company uuid) returns table(user_id uuid,email text,role text) language sql security invoker set search_path='' as $$ select * from private.get_basic_members(p_company) $$;
revoke all on function public.get_basic_members(uuid) from public,anon,authenticated;
grant execute on function public.get_basic_members(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
