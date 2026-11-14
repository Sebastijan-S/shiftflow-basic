import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createWorkspace } from "./demo";
import { cloudState, migrateState, type StoredState } from "./storage";

let client: SupabaseClient | null = null;
export function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  client ??= createClient(url, key);
  return client;
}
function database() { const db = getSupabase(); if (!db) throw new Error("Supabase projekat još nije povezan."); return db; }
export interface CloudWorkspace { company_id: string; version: number; state: StoredState; user_id: string; role: "owner" | "manager"; access_status: string; trial_ends_at: string | null }
export async function loadCloud(companyId?: string): Promise<CloudWorkspace> {
  const db = database();
  const { data: { user }, error: authError } = await db.auth.getUser();
  if (authError || !user) throw new Error("Prijavite se da otvorite poslovni prostor.");
  const { data: memberships, error: memberError } = await db.from("memberships").select("company_id,role").eq("user_id", user.id).order("created_at");
  if (memberError) throw new Error("Nije moguće učitati poslovni prostor: " + memberError.message);
  const selected = companyId ?? localStorage.getItem(`shiftflow:active:${user.id}`);
  if (companyId && !memberships?.some(m => m.company_id === companyId)) throw new Error("Pristup ovom objektu je uklonjen.");
  const membership = memberships?.find(m => m.company_id === selected) ?? memberships?.[0];
  if (!membership) throw new Error("Još nemate poslovni prostor. Kreirajte objekat ili prihvatite poziv vlasnika.");
  localStorage.setItem(`shiftflow:active:${user.id}`, membership.company_id);
  const { data, error } = await db.from("workspace_documents").select("company_id,version,state").eq("company_id", membership.company_id).single();
  if (error) throw error;
  const { data: details, error: companyError } = await db.from("companies").select("name,access_status,trial_ends_at").eq("id", membership.company_id).single();
  if (companyError) throw companyError;
  if (!data.state?.current) {
    const current = createWorkspace(details.name);
    const state: StoredState = { schema: 2, revision: 0, current, past: [], future: [] };
    const version = await saveCloud(membership.company_id, state, data.version);
    return { company_id: membership.company_id, version, state, user_id: user.id, role: membership.role, access_status: details.access_status, trial_ends_at: details.trial_ends_at };
  }
  return { ...data, state: migrateState(data.state), user_id: user.id, role: membership.role, access_status: details.access_status, trial_ends_at: details.trial_ends_at };
}
export async function saveCloud(companyId: string, state: StoredState, version: number, operationId = crypto.randomUUID()): Promise<number> {
  const { data, error } = await database().rpc("save_workspace_v2", { p_company: companyId, p_state: cloudState(state), p_expected_version: version, p_operation: operationId });
  if (error) {
    if (error.message.includes("VERSION_CONFLICT")) throw new Error("VERSION_CONFLICT");
    const failure = new Error("Čuvanje u bazi nije uspelo: " + error.message) as Error & { retryable: boolean };
    failure.retryable = !error.code || error.code.startsWith("PGRST") || error.code === "57014";
    throw failure;
  }
  return data as number;
}
export async function revokeShare(companyId: string, week: string) {
  const { error } = await database().rpc("revoke_schedule_link", { p_company: companyId, p_week: week }); if (error) throw error;
}
export async function createShare(companyId: string, week: string) {
  const { data, error } = await database().rpc("rotate_schedule_link", { p_company: companyId, p_week: week });
  if (error) throw error;
  return `${location.origin}/?share=${data}`;
}
export async function loadShared(token: string) {
  const { data, error } = await database().rpc("read_shared_schedule", { p_token: token });
  if (error || !data) throw new Error("Ovaj link je opozvan, istekao ili raspored još nije objavljen.");
  return data;
}
