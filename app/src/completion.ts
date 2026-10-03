/**
 * GWToolbox completion sync.
 *
 * A small uploader on the player's machine (uploader/gw1-upload.py) sends
 * character_completion.json to Supabase, where it sits in one row per
 * account. The file is stored exactly as GWToolbox wrote it: decoding it
 * into characters, skills, maps and missions happens here, where the id
 * tables live and the logic is tested.
 *
 * The uploader authenticates with a device token, not an account session —
 * see supabase/completion.sql. Nothing in this file holds that token; the
 * browser is signed in normally and reads its own row.
 */
import {
  mergeCompletion,
  type CharacterChange,
  type ToolboxCompletionFile,
} from "@gw1/engine";
import { supabase } from "./supabase";
import { index, mapIds } from "./data";
import type { CharacterSave } from "./save";

export interface CompletionUpload {
  data: ToolboxCompletionFile;
  uploadedAt: string;
  deviceId: string | null;
}

export interface LinkedDevice {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
}

/** The latest file this account's uploader sent, if any. */
export async function fetchCompletionUpload(userId: string): Promise<CompletionUpload | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("completion_uploads")
    .select("data, uploaded_at, device_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    data: data.data as ToolboxCompletionFile,
    uploadedAt: data.uploaded_at as string,
    deviceId: (data.device_id as string | null) ?? null,
  };
}

/** Fold an upload into the characters. Additive — see mergeCompletion. */
export function applyCompletion(
  characters: CharacterSave[],
  file: ToolboxCompletionFile,
): { characters: CharacterSave[]; changes: CharacterChange[] } {
  return mergeCompletion(characters, file, index, mapIds, (base) => ({ ...base, builds: [] }));
}

/** One line for the account bar: "Added 2 characters; 41 skills, 9 outposts". */
export function describeImport(changes: CharacterChange[]): string | null {
  const created = changes.filter((c) => c.created);
  const sum = (pick: (c: CharacterChange) => number) => changes.reduce((n, c) => n + pick(c), 0);
  const parts: string[] = [];
  if (created.length > 0) {
    parts.push(`added ${created.length} character${created.length === 1 ? "" : "s"} (${created.map((c) => c.name).join(", ")})`);
  }
  const counted: Array<[number, string, string]> = [
    [sum((c) => c.skills), "skill", "skills"],
    [sum((c) => c.locations), "place", "places"],
    [sum((c) => c.missions), "mission", "missions"],
    [sum((c) => c.missionsHard), "hard mode mission", "hard mode missions"],
    [sum((c) => c.vanquishes), "vanquish", "vanquishes"],
  ];
  for (const [n, one, many] of counted) {
    if (n > 0) parts.push(`${n} ${n === 1 ? one : many}`);
  }
  if (parts.length === 0) return null;
  return `GWToolbox: ${parts.join(", ")}.`;
}

// ---------------------------------------------------------------------------
// Linking a machine
// ---------------------------------------------------------------------------

/** A short code to type into the uploader. Single use, 15 minutes. */
export async function createPairingCode(): Promise<{ code: string; expiresAt: string }> {
  if (!supabase) throw new Error("Accounts aren't configured for this site.");
  const { data, error } = await supabase.rpc("create_pairing_code");
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.code) throw new Error("No code came back.");
  return { code: row.code as string, expiresAt: row.expires_at as string };
}

export async function listDevices(): Promise<LinkedDevice[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("devices")
    .select("id, label, created_at, last_used_at")
    .order("created_at", { ascending: true });
  if (error || !data) return [];
  return data.map((d) => ({
    id: d.id as string,
    label: d.label as string,
    createdAt: d.created_at as string,
    lastUsedAt: (d.last_used_at as string | null) ?? null,
  }));
}

/** Revoking deletes the token's only record, so the machine goes quiet. */
export async function revokeDevice(id: string): Promise<string | null> {
  if (!supabase) return "Accounts aren't configured for this site.";
  const { error } = await supabase.from("devices").delete().eq("id", id);
  return error ? error.message : null;
}

/** What the uploader needs to be told, so the page can print the command. */
export const uploaderSettings = {
  url: import.meta.env.VITE_SUPABASE_URL ?? "",
  anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? "",
};
