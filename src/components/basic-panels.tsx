"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button } from "./ui/button";
import { getSupabase } from "@/lib/supabase";
import { DAY_NAMES, type Workspace, type Absence, type Requirement } from "@/lib/scheduler";

type Props = { workspace: Workspace; commit: (workspace: Workspace, label: string) => void };
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

export function BasicAvailability({ workspace: w, commit }: Props) {
  const [error, setError] = useState("");
  const [kind, setKind] = useState("absence");
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const f = new FormData(event.currentTarget); setError("");
    const employeeId = String(f.get("employee")), from = String(f.get("from")), to = String(f.get("to") || from);
    const start = String(f.get("start")), end = String(f.get("end"));
    if (kind === "available" || kind === "recurring") {
      if (start >= end) { setError("Interval dostupnosti mora da se završi istog dana, posle početka. Noćnu dostupnost unesite za oba dana."); return; }
      if (kind === "available") commit({ ...w, dateAvailability: [...(w.dateAvailability ?? []).filter(v => !(v.employeeId === employeeId && v.date === from)), { id: crypto.randomUUID(), employeeId, date: from, start, end }] }, "Datumska dostupnost");
      else { const day = Number(f.get("day")); commit({ ...w, employees: w.employees.map(e => e.id === employeeId ? { ...e, daysOff: e.daysOff.filter(d => d !== day), availability: [...(e.availability ?? []).filter(v => v.day !== day), { day, start, end }] } : e) }, "Ponavljajuća dostupnost u delu dana"); }
    } else {
      if (to < from) { setError("Kraj perioda ne može biti pre početka."); return; }
      commit({ ...w, absences: [...(w.absences ?? []), { id: crypto.randomUUID(), employeeId, from, to, kind: kind as Absence["kind"], reason: String(f.get("reason") || "") }] }, "Unet zahtev ili odsustvo");
    }
  };
  return <section className="panel basic-panel"><h2>Odsustva, želje i delimična dostupnost</h2><p className="muted">Odobreno odsustvo i nedostupnost su zabrane. Želja za slobodnim danom je preferencija. Dostupnost za datum zamenjuje nedeljni obrazac, ali ne poništava odsustvo.</p>
    {!w.employees.some(e => e.active) ? <p>Prvo dodajte zaposlene.</p> : <form className="settings-form" onSubmit={submit}>
      <div className="form-columns"><label>Zaposleni<select name="employee" required>{w.employees.filter(e => e.active).map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label><label>Vrsta<select value={kind} onChange={e => setKind(e.target.value)}><option value="absence">Odobreno odsustvo</option><option value="unavailable">Nedostupnost</option><option value="wish">Želja za slobodnim danom</option><option value="available">Dostupnost za datum</option><option value="recurring">Nedeljna dostupnost u delu dana</option></select></label></div>
      {kind === "recurring" ? <label>Dan<select name="day">{DAY_NAMES.map((d, i) => <option key={d} value={i}>{d}</option>)}</select></label> : <div className="form-columns"><label>{kind === "available" ? "Datum" : "Od"}<input type="date" name="from" required /></label>{kind !== "available" && <label>Do<input type="date" name="to" required /></label>}</div>}
      {kind === "available" || kind === "recurring" ? <div className="form-columns"><label>Od<input type="time" name="start" required defaultValue="08:00" /></label><label>Do<input type="time" name="end" required defaultValue="16:00" /></label></div> : <label>Interni razlog / napomena<input name="reason" maxLength={300} /></label>}
      {error && <p role="alert" className="form-error">{error}</p>}<Button type="submit">Dodaj uslov</Button>
    </form>}
    <div className="basic-rows">{(w.absences ?? []).map(a => <div key={a.id}><span><strong>{w.employees.find(e => e.id === a.employeeId)?.name}</strong><small>{a.from}–{a.to} · {a.kind === "wish" ? "Želja" : a.kind === "absence" ? "Odobreno odsustvo" : "Nedostupnost"}{a.reason && ` · ${a.reason}`}</small></span><Button variant="ghost" size="sm" onClick={() => commit({ ...w, absences: w.absences?.filter(v => v.id !== a.id) }, "Uklonjeno odsustvo ili želja")}>Ukloni</Button></div>)}
      {(w.dateAvailability ?? []).map(a => <div key={a.id}><span><strong>{w.employees.find(e => e.id === a.employeeId)?.name}</strong><small>{a.date} · dostupan {a.start}–{a.end}</small></span><Button variant="ghost" size="sm" onClick={() => commit({ ...w, dateAvailability: w.dateAvailability?.filter(v => v.id !== a.id) }, "Uklonjen datumski interval")}>Ukloni</Button></div>)}
      {w.employees.flatMap(e => (e.availability ?? []).map(a => <div key={`${e.id}-${a.day}`}><span><strong>{e.name}</strong><small>Svaki {DAY_NAMES[a.day].toLowerCase()} · {a.start}–{a.end}</small></span><Button variant="ghost" size="sm" onClick={() => commit({ ...w, employees: w.employees.map(p => p.id === e.id ? { ...p, availability: p.availability?.filter(v => v.day !== a.day) } : p) }, "Uklonjen nedeljni interval")}>Ukloni</Button></div>))}
    </div>
  </section>;
}

export function BasicSettings({ workspace: w, commit, week }: Props & { week: string }) {
  const [error, setError] = useState(""); const [override, setOverride] = useState(false);
  const positions = w.positions ?? ["Barista", "Konobar", "Menadžer"];
  const requirements = w.requirementOverrides?.[week] ?? w.requirements;
  const changeRequirement = (r: Requirement) => commit({ ...w, requirementOverrides: { ...w.requirementOverrides, [week]: [...requirements.filter(v => !(v.day === r.day && v.templateId === r.templateId && v.position === r.position)), r] } }, "Potrebe samo za izabranu nedelju");
  return <div className="settings-grid basic-panel">
    <section className="panel"><h2>Pozicije u objektu</h2><p className="muted">Radna pozicija „Menadžer“ ne daje pristup aplikaciji. Nalozima upravlja vlasnik u delu Pristup.</p><div className="position-options">{positions.map(p => <span key={p} className="tag">{p}</span>)}</div><form className="settings-form" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); const name = String(f.get("position")).trim(); if (positions.some(p => p.toLowerCase() === name.toLowerCase())) { setError("Pozicija već postoji."); return; } commit({ ...w, positions: [...positions, name] }, "Dodata pozicija"); e.currentTarget.reset(); setError(""); }}><label>Nova pozicija<input name="position" required maxLength={40} /></label><Button type="submit">Dodaj poziciju</Button></form></section>
    <section className="panel"><h2>Dodaj smenu</h2><p className="muted">Međusmena, treća ili druga smena po potrebi. Novi predlog traje osam sati.</p><form className="settings-form" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); const start = String(f.get("start")), end = String(f.get("end")); if (start === end) { setError("Početak i kraj moraju biti različiti."); return; } const days = f.getAll("days").map(Number); if (!days.length) { setError("Izaberite bar jedan dan korišćenja."); return; } commit({ ...w, templates: [...w.templates, { id: crypto.randomUUID(), name: String(f.get("name")).trim(), start, end, color: String(f.get("color")), days }] }, "Dodata smena"); e.currentTarget.reset(); setError(""); }}>
      <label>Naziv<input name="name" required maxLength={60} placeholder="Međusmena" /></label><div className="form-columns"><label>Početak<input type="time" name="start" required defaultValue="11:00" /></label><label>Kraj<input type="time" name="end" required defaultValue="19:00" /></label></div><label>Boja<select name="color">{["mint", "blue", "purple", "peach", "pink", "yellow"].map(c => <option key={c}>{c}</option>)}</select></label><fieldset><legend>Dani korišćenja</legend><div className="position-options">{DAY_NAMES.map((d, i) => <label key={d}><input type="checkbox" name="days" value={i} defaultChecked />{d.slice(0, 3)}</label>)}</div></fieldset><Button type="submit">Dodaj smenu</Button>
    </form></section>
    <section className="panel basic-wide"><h2>Izuzetak potreba za nedelju od {week}</h2><p className="muted">Osnovni obrazac ostaje sačuvan. Izuzetak važi samo za prikazanu nedelju i njene datume; ponovo generišite nacrt da ga primenite.</p><Button variant="outline" onClick={() => setOverride(v => !v)}>{override ? "Zatvori izuzetak" : "Uredi potrebe ove nedelje"}</Button>{w.requirementOverrides?.[week] && <Button variant="ghost" onClick={() => { const next = { ...w.requirementOverrides }; delete next[week]; commit({ ...w, requirementOverrides: next }, "Vraćen osnovni obrazac potreba"); }}>Vrati osnovni obrazac</Button>}
      {override && <div className="requirements-editor">{DAY_NAMES.map((d, day) => <details key={d}><summary>{d}</summary>{w.templates.filter(t => !t.days || t.days.includes(day)).map(t => <div className="requirement-row" key={t.id}><strong>{t.name}</strong>{positions.map(p => <label key={p}>{p}<input type="number" min={0} max={20} value={requirements.find(r => r.day === day && r.templateId === t.id && r.position === p)?.count ?? 0} onChange={e => changeRequirement({ day, templateId: t.id, position: p, count: Math.max(0, Math.min(20, Number(e.target.value))) })} /></label>)}</div>)}</details>)}</div>}
    </section>{error && <p className="form-error" role="alert">{error}</p>}
  </div>;
}

export function BasicAccess({ companyId, role, flush, reconnect }: { companyId: string; role: string | null; flush: () => Promise<boolean>; reconnect: (companyId?: string) => Promise<void> }) {
  const [members, setMembers] = useState<{ user_id: string; email: string; role: string }[]>([]);
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([]);
  const [url, setUrl] = useState(""); const [error, setError] = useState("");
  const refresh = async () => {
    const db = getSupabase()!;
    const [{ data: ms }, { data: cs }] = await Promise.all([db.rpc("get_basic_members", { p_company: companyId }), db.from("companies").select("id,name").order("created_at")]);
    setMembers(ms ?? []); setCompanies(cs ?? []);
  };
  useEffect(() => { void refresh(); }, [companyId]); // Re-read role changes when the object changes.
  return <section className="panel basic-panel"><h2>Pristup i objekti</h2><p className="muted">Vaša korisnička uloga: {role === "owner" ? "vlasnik" : "menadžer"}. Zaposlenima nisu potrebni nalozi.</p>
    {companies.length > 1 && <label className="settings-form">Aktivan objekat<select value={companyId} onChange={async e => { const id = e.target.value; if (await flush()) await reconnect(id); else setError("Prvo sačuvajte izmene trenutnog objekta."); }}>{companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
    {role === "owner" && <form className="settings-form" onSubmit={async e => { e.preventDefault(); const f = new FormData(e.currentTarget); try { const { data, error } = await getSupabase()!.rpc("create_manager_invitation", { p_company: companyId, p_email: String(f.get("email")) }); if (error) throw error; setUrl(`${location.origin}/?invite=${data}`); setError(""); } catch (e) { setError(message(e)); } }}><label>Email menadžera<input type="email" name="email" required /></label><Button type="submit">Napravi pozivni link</Button>{url && <label>Poziv važi sedam dana<input readOnly value={url} onFocus={e => e.currentTarget.select()} /><Button type="button" variant="outline" onClick={() => void navigator.clipboard.writeText(url).catch(e => setError(message(e)))}>Kopiraj poziv</Button></label>}</form>}
    <div className="basic-rows">{members.map(m => <div key={m.user_id}><span><strong>{m.role === "owner" ? "Vlasnik" : "Menadžer"}</strong><small>{m.email}</small></span>{role === "owner" && m.role === "manager" && <Button variant="ghost" size="sm" onClick={async () => { const { error } = await getSupabase()!.rpc("remove_manager", { p_company: companyId, p_user: m.user_id }); if (error) setError(error.message); else void refresh(); }}>Ukloni pristup</Button>}</div>)}</div>{error && <p className="form-error" role="alert">{error}</p>}
  </section>;
}

export function BasicTrial({ companyId, role, workspace: w, flush, go }: { companyId: string; role: string | null; workspace: Workspace; flush: () => Promise<boolean>; go: (page: "Zaposleni" | "Podešavanja" | "Pravila rada") => void }) {
  const [company, setCompany] = useState<{ access_status: string; trial_ends_at: string | null } | null>(null);
  const [error, setError] = useState(""); const [clock, setClock] = useState(Date.now());
  const refresh = async () => { const { data } = await getSupabase()!.from("companies").select("access_status,trial_ends_at").eq("id", companyId).single(); setCompany(data); };
  useEffect(() => { void refresh(); const timer = setInterval(() => { setClock(Date.now()); void refresh(); }, 60000); return () => clearInterval(timer); }, [companyId]);
  if (!company) return null;
  const days = company.trial_ends_at ? Math.max(0, Math.ceil((Date.parse(company.trial_ends_at) - clock) / 86400000)) : null;
  const expired = company.access_status === "expired" || (company.access_status === "trial" && days === 0);
  return <section className={`panel trial-panel ${expired || (days !== null && days <= 3) ? "trial-attention" : ""}`}><div><span className="tag">ShiftFlow Basic</span><h2>{company.access_status === "setup" ? "Pripremite objekat za prvi raspored" : expired ? "Probni period je istekao" : company.access_status === "active" ? "Basic je aktivan" : `Preostalo ${days} dana probe`}</h2>
    {company.access_status === "setup" ? <><p className="muted">Priprema ne troši probni period. Kada unesete tim i potrebe, vlasnik pokreće 21 dan probe.</p><div className="onboarding-steps"><button onClick={() => go("Zaposleni")}>{w.employees.length ? "✓" : "1"} Zaposleni</button><button onClick={() => go("Podešavanja")}>2 Smene i pozicije</button><button onClick={() => go("Pravila rada")}>{w.requirements.some(r => r.count > 0) ? "✓" : "3"} Potrebe i pravila</button></div></> : <p className="muted">{expired ? "Podaci ostaju dostupni za pregled i izvoz. Za nastavak kontaktirajte vlasnika ili podršku prema dogovoru o pilotu." : company.trial_ends_at ? `Proba traje do ${new Date(company.trial_ends_at).toLocaleString("sr-Latn-RS", { timeZone: "Europe/Belgrade" })}.` : "Planiranje i deljenje rasporeda za vaš objekat."}</p>}
    </div>{company.access_status === "setup" && role === "owner" && <Button onClick={async () => { try { if (!(await flush())) throw new Error("Sačekajte uspešno čuvanje podataka."); const { error } = await getSupabase()!.rpc("start_basic_trial", { p_company: companyId }); if (error) throw error; await refresh(); } catch (e) { setError(message(e)); } }}>Pokreni 21 dan probe</Button>}{error && <p className="form-error" role="alert">{error}</p>}
  </section>;
}

export function BasicNotifications({ companyId }: { companyId: string | null }) {
  const [items, setItems] = useState<{ id: string; message: string; created_at: string }[]>([]);
  const [read, setRead] = useState<string[]>([]); const [error, setError] = useState("");
  useEffect(() => { if (!companyId) return; const db = getSupabase()!; void Promise.all([db.from("notifications").select("id,message,created_at").eq("company_id", companyId).order("created_at", { ascending: false }).limit(50), db.from("notification_reads").select("notification_id").eq("company_id", companyId)]).then(([ns, rs]) => { if (ns.error || rs.error) { setError(ns.error?.message || rs.error!.message); return; } setItems(ns.data ?? []); setRead((rs.data ?? []).map(r => r.notification_id)); }); }, [companyId]);
  return <div className="basic-rows">{!companyId ? <p>Serverska obaveštenja su dostupna u povezanom poslovnom prostoru.</p> : !items.length ? <p>Nema novih obaveštenja.</p> : items.map(n => <div key={n.id}><span><strong>{n.message}</strong><small>{new Date(n.created_at).toLocaleString("sr-Latn-RS")}</small></span>{read.includes(n.id) ? <span className="tag">Pročitano</span> : <Button size="sm" variant="ghost" onClick={async () => { const { error } = await getSupabase()!.rpc("mark_notification_read", { p_company: companyId, p_notification: n.id }); if (error) setError(error.message); else setRead(v => [...v, n.id]); }}>Označi pročitano</Button>}</div>)}{error && <p className="form-error" role="alert">{error}</p>}</div>;
}
