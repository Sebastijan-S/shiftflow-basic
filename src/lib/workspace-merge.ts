import type { Workspace } from "./scheduler";

const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
function identity(v: unknown): string | null {
  if (!record(v)) return null;
  if (typeof v.id === "string") return v.id;
  if (v.day !== undefined && v.templateId && v.position) return `${v.day}|${v.templateId}|${v.position}`;
  return null;
}

/** Rebase only the fields changed locally. Independent remote edits are preserved. */
export function mergeWorkspace(base: Workspace, local: Workspace, remote: Workspace, strict = false): Workspace {
  function merge(b: unknown, l: unknown, r: unknown): unknown {
    if (equal(b, l)) return r;
    if (equal(b, r) || equal(l, r)) return l;
    if (b !== undefined && (l === undefined || r === undefined)) throw new Error("Zapis je u međuvremenu izmenjen ili obrisan. Pregledajte novije podatke.");
    if (Array.isArray(b) && Array.isArray(l) && Array.isArray(r) && [...b, ...l, ...r].every(v => typeof v !== "object")) {
      const removed = new Set(b.filter(v => !l.includes(v)));
      return [...new Set([...r.filter(v => !removed.has(v)), ...l.filter(v => !b.includes(v))])];
    }
    if (Array.isArray(b) && Array.isArray(l) && Array.isArray(r) && [...b, ...l, ...r].every(v => identity(v) !== null)) {
      const bm = new Map(b.map(v => [identity(v)!, v])), lm = new Map(l.map(v => [identity(v)!, v])), rm = new Map(r.map(v => [identity(v)!, v]));
      const result: unknown[] = [];
      for (const key of new Set([...rm.keys(), ...lm.keys(), ...bm.keys()])) {
        if (bm.has(key) && !lm.has(key)) { if (rm.has(key) && !equal(bm.get(key), rm.get(key))) throw new Error("Zapis je u međuvremenu izmenjen. Pregledajte noviju verziju pre brisanja."); continue; }
        if (bm.has(key) && !rm.has(key) && lm.has(key)) { if (!equal(bm.get(key), lm.get(key))) throw new Error("Zapis je u međuvremenu obrisan. Izmena je ostala lokalno."); continue; }
        result.push(merge(bm.get(key), lm.has(key) ? lm.get(key) : bm.get(key), rm.get(key)));
      }
      return result.filter(v => v !== undefined);
    }
    if (record(b) && record(l) && record(r)) {
      const result: Record<string, unknown> = {};
      for (const key of new Set([...Object.keys(b), ...Object.keys(l), ...Object.keys(r)])) {
        const value = merge(b[key], l[key], r[key]); if (value !== undefined) result[key] = value;
      }
      return result;
    }
    if (strict) throw new Error("Ovu vrednost je u međuvremenu promenio drugi korisnik. Poništavanje bi prepisalo noviju izmenu.");
    return l;
  }
  return merge(base, local, remote) as Workspace;
}
