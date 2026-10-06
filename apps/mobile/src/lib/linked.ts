/**
 * Which stores this device has a live signed-in session for. Because the
 * session lives in the WebView on the phone, "connected" is device-local
 * state, remembered here so the app shows it without asking again.
 */
import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'fca.linked';
const RELINK = 'fca.relink';
let linked: string[] = [];
// Stores whose session lapsed at the store: still "yours", but a 20-second re-connect is due.
let relink: string[] = [];
let loaded = false;
const subs = new Set<() => void>();

async function ensure(): Promise<void> {
  if (loaded) return;
  try { linked = JSON.parse((await AsyncStorage.getItem(KEY)) ?? '[]') as string[]; } catch { linked = []; }
  try { relink = JSON.parse((await AsyncStorage.getItem(RELINK)) ?? '[]') as string[]; } catch { relink = []; }
  loaded = true;
}
function emit(): void { void AsyncStorage.setItem(KEY, JSON.stringify(linked)); void AsyncStorage.setItem(RELINK, JSON.stringify(relink)); for (const f of subs) f(); }

export function markLinked(id: string): void { const was = relink.includes(id); relink = relink.filter((x) => x !== id); if (!linked.includes(id)) { linked = [...linked, id]; emit(); } else if (was) emit(); }
/** The store dropped the session (not the person): keep it listed as theirs, ask for the quick re-connect. */
export function markNeedsRelink(id: string): void { if (!relink.includes(id)) { relink = [...relink, id]; emit(); } }
export function markUnlinked(id: string): void { linked = linked.filter((x) => x !== id); relink = relink.filter((x) => x !== id); emit(); }

export function useLinked(): string[] {
  const [v, setV] = useState<string[]>(linked);
  useEffect(() => { let a = true; void ensure().then(() => a && setV([...linked])); const f = () => a && setV([...linked]); subs.add(f); return () => { a = false; subs.delete(f); }; }, []);
  return v;
}

export function useRelink(): string[] {
  const [v, setV] = useState<string[]>(relink);
  useEffect(() => { let a = true; void ensure().then(() => a && setV([...relink])); const f = () => a && setV([...relink]); subs.add(f); return () => { a = false; subs.delete(f); }; }, []);
  return v;
}
