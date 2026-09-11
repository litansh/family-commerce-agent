/** The shopping list, shared by every screen and persisted on the device. */
import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ListLine } from '@fca/domain';

export type Line = Omit<ListLine, 'id'> & { id: string; imageUrl?: string | null; productName?: string };
const KEY = 'fca.list';

let lines: Line[] = [];
let loaded = false;
const subs = new Set<(l: Line[]) => void>();

async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  // Driven simulator runs start with an empty list.
  if (process.env['EXPO_PUBLIC_E2E_RESET_LIST'] === '1') { try { await AsyncStorage.removeItem(KEY); } catch { /* ignore */ } lines = []; loaded = true; return; }
  try { const raw = await AsyncStorage.getItem(KEY); lines = raw ? (JSON.parse(raw) as Line[]) : []; } catch { lines = []; }
  loaded = true;
}
function emit(): void { for (const s of subs) s(lines); void AsyncStorage.setItem(KEY, JSON.stringify(lines)); }

export const newId = (): string => Math.random().toString(36).slice(2, 10);
export function setLines(next: Line[] | ((prev: Line[]) => Line[])): void { lines = typeof next === 'function' ? next(lines) : next; emit(); }
export function addLine(l: Omit<Line, 'id'>): void { setLines((xs) => [...xs, { id: newId(), ...l }]); }
export function removeLine(id: string): void { setLines((xs) => xs.filter((x) => x.id !== id)); }
export function clearList(): void { setLines([]); }

/** Subscribe a screen to the shared list. */
export function useList(): Line[] {
  const [state, setState] = useState<Line[]>(lines);
  useEffect(() => {
    let alive = true;
    void ensureLoaded().then(() => { if (alive) setState([...lines]); });
    const fn = (l: Line[]) => { if (alive) setState([...l]); };
    subs.add(fn);
    return () => { alive = false; subs.delete(fn); };
  }, []);
  return state;
}

// Kept for older call sites.
export const loadList = async (): Promise<Line[]> => { await ensureLoaded(); return lines; };
export const saveList = async (l: Line[]): Promise<void> => { setLines(l); };
