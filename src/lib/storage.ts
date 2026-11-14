import { snapshotAssignment, type Workspace } from "./scheduler";
import { mergeWorkspace } from "./workspace-merge";
export interface HistoryEntry { label: string; time: string; snapshot: Workspace; after?: Workspace }
export interface StoredState { schema: 1 | 2; revision: number; current: Workspace; past: HistoryEntry[]; future: HistoryEntry[] }
export const STORAGE_KEY = "shiftflow:demo:v1";
export function companyStorageKey(userId: string, companyId: string) { return `shiftflow:user:${userId}:company:${companyId}:v2`; }
export function migrateState(parsed: StoredState): StoredState {
  if (![1, 2].includes(parsed.schema) || !Array.isArray(parsed.current?.employees) || !parsed.current?.schedules || !Array.isArray(parsed.past) || !Array.isArray(parsed.future)) throw new Error("Sačuvani podaci nisu u podržanom formatu.");
  const normalize = (w: Workspace): Workspace => ({ ...w, positions: w.positions ?? [...new Set(["Barista", "Konobar", "Menadžer", ...w.employees.flatMap(e => e.positions)])], absences: w.absences ?? [], dateAvailability: w.dateAvailability ?? [], replacements: w.replacements ?? [], requirementOverrides: w.requirementOverrides ?? {}, schedules: Object.fromEntries(Object.entries(w.schedules).map(([key, s]) => [key, { ...s, assignments: s.assignments.map(a => snapshotAssignment(a, w.templates)) }])) });
  return { ...parsed, schema: 2, current: normalize(parsed.current), past: parsed.past.map(h => ({ ...h, snapshot: normalize(h.snapshot), after: h.after ? normalize(h.after) : undefined })), future: parsed.future.map(h => ({ ...h, snapshot: normalize(h.snapshot), after: h.after ? normalize(h.after) : undefined })) };
}
export function readState(key = STORAGE_KEY): StoredState | null {
  const value = localStorage.getItem(key);
  if (!value) return null;
  return migrateState(JSON.parse(value) as StoredState);
}
export function writeState(state: StoredState, key = STORAGE_KEY) {
  const stored = { ...state, past: [...state.past], future: [...state.future] };
  let json = JSON.stringify(stored);
  while (json.length > 900_000 && (stored.past.length || stored.future.length)) { if (stored.past.length) stored.past.shift(); else stored.future.shift(); json = JSON.stringify(stored); }
  localStorage.setItem(key, json);
}
export function cloudState(state: StoredState): StoredState { return { schema: 2, revision: state.revision, current: state.current, past: [], future: [] }; }
export function applyChange(state: StoredState, current: Workspace, label: string): StoredState {
  return { schema: 2, revision: state.revision + 1, current, past: [...state.past, { label, time: new Date().toISOString(), snapshot: state.current, after: current }].slice(-100), future: [] };
}
export function undoState(state: StoredState): StoredState {
  const last = state.past.at(-1); if (!last) return state;
  const current = last.after ? mergeWorkspace(last.after, last.snapshot, state.current, true) : last.snapshot;
  return { ...state, revision: state.revision + 1, current, past: state.past.slice(0, -1), future: [...state.future, { label: last.label, time: new Date().toISOString(), snapshot: state.current, after: current }] };
}
export function redoState(state: StoredState): StoredState {
  const next = state.future.at(-1); if (!next) return state;
  const current = next.after ? mergeWorkspace(next.after, next.snapshot, state.current, true) : next.snapshot;
  return { ...state, revision: state.revision + 1, current, past: [...state.past, { label: next.label, time: new Date().toISOString(), snapshot: state.current, after: current }], future: state.future.slice(0, -1) };
}
