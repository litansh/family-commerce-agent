/**
 * Which stores this device has a live signed-in session for. Because the
 * session lives in the WebView on the phone, "connected" is device-local
 * state, remembered here so the app shows it without asking again.
 */
import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'fca.linked';
let linked: string[] = [];
let loaded = false;
const subs = new Set<() => void>();

async function ensure(): Promise<void> {
  if (loaded) return;
  try { linked = JSON.parse((await AsyncStorage.getItem(KEY)) ?? '[]') as string[]; } catch { linked = []; }
  loaded = true;
}
function emit(): void { void AsyncStorage.setItem(KEY, JSON.stringify(linked)); for (const f of subs) f(); }

export function markLinked(id: string): void { if (!linked.includes(id)) { linked = [...linked, id]; emit(); } }
export function markUnlinked(id: string): void { linked = linked.filter((x) => x !== id); emit(); }

export function useLinked(): string[] {
  const [v, setV] = useState<string[]>(linked);
  useEffect(() => { let a = true; void ensure().then(() => a && setV([...linked])); const f = () => a && setV([...linked]); subs.add(f); return () => { a = false; subs.delete(f); }; }, []);
  return v;
}
