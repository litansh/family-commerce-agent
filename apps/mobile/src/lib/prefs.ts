/**
 * The household's buying mode - cheap, balanced or fast - chosen once on the
 * list and remembered on the device. The compare screen opens in it.
 */
import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type BuyMode = 'cheap' | 'balanced' | 'fast';
export const MODES: BuyMode[] = ['cheap', 'balanced', 'fast'];
const KEY = 'fca.mode';
let mode: BuyMode = 'cheap';
let loaded = false;
const subs = new Set<() => void>();

async function ensure(): Promise<void> {
  if (loaded) return;
  try { const v = await AsyncStorage.getItem(KEY); if (v === 'cheap' || v === 'balanced' || v === 'fast') mode = v; } catch { /* keep default */ }
  loaded = true;
}

export function setMode(m: BuyMode): void { mode = m; void AsyncStorage.setItem(KEY, m); for (const f of subs) f(); }
export function getMode(): BuyMode { return mode; }

export function useMode(): BuyMode {
  const [v, setV] = useState<BuyMode>(mode);
  useEffect(() => { let a = true; void ensure().then(() => a && setV(mode)); const f = () => a && setV(mode); subs.add(f); return () => { a = false; subs.delete(f); }; }, []);
  return v;
}
