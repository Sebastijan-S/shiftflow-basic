export type Position = string;
export type Severity = "warning" | "block";
export interface Employee {
  id: string; name: string; initials: string; color: string; positions: Position[];
  targetHours: number; active: boolean; daysOff: number[]; preferredShift?: string; maxHours?: number;
  availability?: { day: number; start: string; end: string }[];
}
export interface ShiftTemplate { id: string; name: string; start: string; end: string; color: string; days?: number[] }
export interface Assignment { id: string; employeeId: string; day: number; templateId: string; position: Position; locked: boolean; note: string; start?: string; end?: string }
export interface Rules { minRestHours: number; maxWeeklyHours: number; restSeverity: Severity; hoursSeverity: Severity; allowMultiple: boolean; restEnabled?: boolean; hoursEnabled?: boolean }
export interface Requirement { day: number; templateId: string; position: Position; count: number }
export interface Absence { id: string; employeeId: string; from: string; to: string; kind: "absence" | "unavailable" | "wish"; reason: string }
export interface DateAvailability { id: string; employeeId: string; date: string; start: string; end: string }
export interface Replacement { id: string; assignmentId: string; week: string; originalEmployeeId: string; replacementEmployeeId: string; note: string; time: string }
export interface Schedule { week: string; status: "draft" | "published"; assignments: Assignment[]; publishedAt?: string; requirements?: Requirement[]; rules?: Rules }
export interface Workspace { name: string; employees: Employee[]; templates: ShiftTemplate[]; rules: Rules; requirements: Requirement[]; schedules: Record<string, Schedule>; positions?: Position[]; absences?: Absence[]; dateAvailability?: DateAvailability[]; replacements?: Replacement[]; requirementOverrides?: Record<string, Requirement[]> }
export interface Conflict { id: string; severity: Severity; message: string; employeeId?: string; day?: number }
export const DAY_NAMES = ["Ponedeljak", "Utorak", "Sreda", "Četvrtak", "Petak", "Subota", "Nedelja"];
export function minutes(time: string) { const [h, m] = time.split(":").map(Number); return h * 60 + m; }
export function duration(template: ShiftTemplate) { return ((minutes(template.end) - minutes(template.start) + 1440) % 1440 || 1440) / 60; }
export function assignmentTemplate(a: Assignment, templates: ShiftTemplate[]): ShiftTemplate {
  const template = templates.find(t => t.id === a.templateId);
  if (!template) throw new Error("Šablon smene ne postoji.");
  return { ...template, start: a.start ?? template.start, end: a.end ?? template.end };
}
export function snapshotAssignment(a: Assignment, templates: ShiftTemplate[]): Assignment {
  const t = assignmentTemplate(a, templates); return { ...a, start: t.start, end: t.end };
}
export function effectiveRequirements(w: Workspace, week: string) {
  return (w.requirementOverrides?.[week] ?? w.requirements).filter(r => { const t = w.templates.find(t => t.id === r.templateId); return t && (!t.days || t.days.includes(r.day)); });
}
export function scheduleRequirements(w: Workspace, schedule: Schedule) { return schedule.requirements ?? effectiveRequirements(w, schedule.week); }
export function interval(a: Assignment, templates: ShiftTemplate[]) {
  const t = assignmentTemplate(a, templates);
  const start = a.day * 1440 + minutes(t.start);
  return { start, end: start + duration(t) * 60 };
}
export function hoursFor(assignments: Assignment[], employeeId: string, templates: ShiftTemplate[]) {
  return assignments.filter(a => a.employeeId === employeeId).reduce((h, a) => h + duration(assignmentTemplate(a, templates)), 0);
}
export function monday(date: Date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Belgrade", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const value = (part: string) => parts.find(p => p.type === part)!.value;
  const d = new Date(`${value("year")}-${value("month")}-${value("day")}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7);
  return d.toISOString().slice(0, 10);
}
export function addDays(date: string, count: number) { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + count); return d.toISOString().slice(0, 10); }
export function weekDates(week: string) { return DAY_NAMES.map((_, i) => new Date(`${addDays(week, i)}T12:00:00Z`)); }
export function neighborAssignments(workspace: Workspace, week: string): Assignment[] {
  return [-7, 7].flatMap(offset => (workspace.schedules[addDays(week, offset)]?.assignments ?? []).map(a => ({ ...a, day: a.day + offset })));
}
export function assignmentConflicts(a: Assignment, assignments: Assignment[], w: Workspace, adjacent: Assignment[] = [], week?: string): Conflict[] {
  const conflicts: Conflict[] = [];
  const employee = w.employees.find(e => e.id === a.employeeId);
  const template = w.templates.find(t => t.id === a.templateId);
  const push = (id: string, message: string, severity: Severity = "block") => conflicts.push({ id: `${a.id}-${id}`, message, severity, employeeId: a.employeeId, day: a.day });
  if (!employee || !template) { push("missing", "Zaposleni ili smena više ne postoji."); return conflicts; }
  if (!employee.active) push("inactive", `${employee.name} nije aktivan član tima.`);
  if (!employee.positions.includes(a.position)) push("position", `${employee.name} nema poziciju ${a.position.toLowerCase()}.`);
  const ai = interval(a, w.templates);
  if (week) {
    for (const absence of w.absences ?? []) {
      if (absence.employeeId !== employee.id) continue;
      const start = (Date.parse(absence.from) - Date.parse(week)) / 60000;
      const end = (Date.parse(absence.to) - Date.parse(week)) / 60000 + 1440;
      if (ai.start < end && start < ai.end) push(`absence-${absence.id}`, `${employee.name}: ${absence.kind === "wish" ? "želi slobodan dan" : "odsustvo ili nedostupnost"} (${absence.from}–${absence.to}).`, absence.kind === "wish" ? "warning" : "block");
    }
  }
  // Availability must cover each calendar-day segment, including the second day of an overnight shift.
  for (let d = Math.floor(ai.start / 1440); d <= Math.floor((ai.end - 1) / 1440); d++) {
    const weekday = ((d % 7) + 7) % 7;
    const date = week ? addDays(week, d) : undefined;
    const specific = date ? (w.dateAvailability ?? []).filter(v => v.employeeId === employee.id && v.date === date) : [];
    const recurring = (employee.availability ?? []).filter(v => v.day === weekday);
    const windows = specific.length ? specific : recurring;
    const segmentStart = Math.max(ai.start, d * 1440), segmentEnd = Math.min(ai.end, (d + 1) * 1440);
    if ((!specific.length && employee.daysOff.includes(weekday)) || (windows.length && !windows.some(v => d * 1440 + minutes(v.start) <= segmentStart && d * 1440 + minutes(v.end) >= segmentEnd))) push(`off-${d}`, `${employee.name} nije dostupan za ceo termin: ${date ?? DAY_NAMES[weekday]}.`);
  }
  if (template.days && !template.days.includes(a.day)) push("template-day", "Ova smena se ne koristi izabranog dana.");
  const own = assignments.filter(b => b.employeeId === a.employeeId && b.id !== a.id);
  for (const b of [...own, ...adjacent.filter(b => b.employeeId === a.employeeId)]) {
    const bi = interval(b, w.templates);
    if (ai.start < bi.end && bi.start < ai.end) push(`overlap-${b.id}`, `${employee.name}: smene se vremenski preklapaju.`);
    else if (a.day === b.day && !w.rules.allowMultiple) push(`double-${b.id}`, `${employee.name}: dozvoljena je jedna smena dnevno.`);
    else {
      if (a.day === b.day && w.rules.allowMultiple) push(`multiple-warning-${b.id}`, `${employee.name}: više smena istog dana.`, "warning");
      const rest = Math.max(ai.start - bi.end, bi.start - ai.end) / 60;
      if (w.rules.restEnabled !== false && rest < w.rules.minRestHours) push(`rest-${b.id}`, `${employee.name}: ${rest} h odmora, potrebno ${w.rules.minRestHours} h.`, w.rules.restSeverity);
    }
  }
  const hours = [...own, a, ...adjacent.filter(b => b.employeeId === employee.id)].reduce((sum, shift) => { const i = interval(shift, w.templates); return sum + Math.max(0, Math.min(10080, i.end) - Math.max(0, i.start)) / 60; }, 0);
  const maximum = employee.maxHours ?? w.rules.maxWeeklyHours;
  if ((employee.maxHours !== undefined || w.rules.hoursEnabled !== false) && hours > maximum) push("hours", `${employee.name}: ${hours} h prelazi limit od ${maximum} h.`, w.rules.hoursSeverity);
  return conflicts;
}
export function missingRequirements(assignments: Assignment[], requirements: Requirement[]) {
  return requirements.map(r => ({ ...r, missing: Math.max(0, r.count - assignments.filter(a => a.day === r.day && a.templateId === r.templateId && a.position === r.position).length) })).filter(r => r.missing > 0);
}
export function validateSchedule(schedule: Schedule, w: Workspace) {
  const adjacent = neighborAssignments(w, schedule.week);
  const context = { ...w, rules: schedule.rules ?? w.rules };
  const all = schedule.assignments.flatMap(a => assignmentConflicts(a, schedule.assignments, context, adjacent, schedule.week));
  const seen = new Set<string>();
  for (const a of schedule.assignments) { if (seen.has(a.id)) all.push({ id: `duplicate-${a.id}`, severity: "block", message: "Dve dodele imaju isti identifikator." }); seen.add(a.id); }
  return [...new Map(all.map(c => [c.id, c])).values()];
}
// Reproducible multi-pass greedy search. Locked assignments remain unchanged.
// Each pass prioritizes constrained roles and scores fair hours/weekends/preferences.
export function generateSchedule(w: Workspace, week: string, keepLocked = true): Schedule {
  const locked = keepLocked ? (w.schedules[week]?.assignments ?? []).filter(a => a.locked) : [];
  const adjacent = neighborAssignments(w, week);
  const available = w.employees.filter(e => e.active);
  const requirements = effectiveRequirements(w, week);
  let best: Assignment[] = [...locked]; let bestScore: number[] | null = null;
  for (let pass = 0; pass < 36; pass++) {
    const result = locked.map(a => ({ ...a }));
    const slots = requirements.flatMap(r => Array.from({ length: Math.max(0, r.count - locked.filter(a => a.day === r.day && a.templateId === r.templateId && a.position === r.position).length) }, (_, i) => ({ ...r, slot: i })));
    slots.sort((a, b) => a.day - b.day || available.filter(e => e.positions.includes(a.position)).length - available.filter(e => e.positions.includes(b.position)).length || a.templateId.localeCompare(b.templateId));
    for (const [index, slot] of slots.entries()) {
      const candidates = available.filter(e => e.positions.includes(slot.position)).map((e, ei) => {
        let slotIndex = slot.slot;
        const prefix = `${week}-${slot.day}-${slot.templateId}-${slot.position}-`;
        while (result.some(a => a.id === `${prefix}${slotIndex}`)) slotIndex++;
        const assignment = snapshotAssignment({ id: `${prefix}${slotIndex}`, employeeId: e.id, day: slot.day, templateId: slot.templateId, position: slot.position, locked: false, note: "" }, w.templates);
        const conflicts = assignmentConflicts(assignment, result, w, adjacent, week);
        const hours = hoursFor(result, e.id, w.templates);
        const weekend = result.filter(a => a.employeeId === e.id && a.day >= 5).length;
        const tie = ((ei * 17 + pass * 13 + index * (pass + 3)) % 31) / 31;
        const score = hours / Math.max(e.targetHours, 8) * 30 + weekend * 5 + (e.preferredShift && e.preferredShift !== slot.templateId ? 4 : 0) + conflicts.length * 12 + tie * 4;
        return { assignment, conflicts, score };
      }).filter(c => !c.conflicts.some(c => c.severity === "block")).sort((a, b) => a.score - b.score || a.assignment.employeeId.localeCompare(b.assignment.employeeId));
      if (candidates[0]) result.push(candidates[0].assignment);
    }
    const score = [missingRequirements(result, requirements).reduce((s, r) => s + r.missing, 0), result.reduce((s, a) => s + assignmentConflicts(a, result, w, adjacent, week).length, 0), available.reduce((s, e) => s + (hoursFor(result, e.id, w.templates) / Math.max(e.targetHours, 8)) ** 2, 0), result.filter(a => { const e = available.find(e => e.id === a.employeeId); return e?.preferredShift && e.preferredShift !== a.templateId; }).length];
    const different = bestScore ? score.findIndex((s, i) => s !== bestScore![i]) : 0;
    if (!bestScore || (different >= 0 && score[different] < bestScore[different])) { best = result; bestScore = score; }
  }
  return { week, status: "draft", assignments: best, requirements: structuredClone(requirements), rules: { ...w.rules } };
}

export function explainMissing(schedule: Schedule, w: Workspace) {
  return missingRequirements(schedule.assignments, scheduleRequirements(w, schedule)).map(r => {
    const candidates = w.employees.filter(e => e.active && e.positions.includes(r.position));
    const reasons = candidates.flatMap(e => assignmentConflicts({ id: "unfilled-candidate", employeeId: e.id, day: r.day, templateId: r.templateId, position: r.position, locked: false, note: "" }, schedule.assignments, w, neighborAssignments(w, schedule.week), schedule.week).filter(c => c.severity === "block").map(c => c.message));
    return { ...r, reasons: candidates.length ? [...new Set(reasons)] : ["Nema aktivnih zaposlenih sa ovom pozicijom."] };
  });
}
