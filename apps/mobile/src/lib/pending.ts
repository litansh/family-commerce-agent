/**
 * Purchases waiting for a word from the family. Kaniti fills a store's cart on
 * the phone, but the store's own checkout is theirs: the memory must not learn
 * "you buy this" from a cart that was abandoned. So a filled cart is remembered
 * here as pending, the Orders tab asks "did you buy it in the end?", and only a
 * "yes" (or the store's own order history showing it) records the purchase.
 */
import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CartLine } from './stores';

export interface PendingPurchase {
  readonly id: string;
  readonly storeId: string;
  readonly at: string;
  readonly lines: readonly CartLine[];
}

const KEY = 'fca.pending';
let pending: PendingPurchase[] = [];
let loaded = false;
const subs = new Set<() => void>();

async function ensure(): Promise<void> {
  if (loaded) return;
  try { pending = JSON.parse((await AsyncStorage.getItem(KEY)) ?? '[]') as PendingPurchase[]; } catch { pending = []; }
  loaded = true;
}
function emit(): void { void AsyncStorage.setItem(KEY, JSON.stringify(pending)); for (const f of subs) f(); }

export function addPending(storeId: string, lines: readonly CartLine[]): PendingPurchase {
  const p: PendingPurchase = { id: `${storeId}-${Date.now()}`, storeId, at: new Date().toISOString(), lines };
  // One open question per store: a second cart at the same store replaces the first.
  pending = [...pending.filter((x) => x.storeId !== storeId), p];
  emit();
  return p;
}
export function resolvePending(id: string): void { pending = pending.filter((x) => x.id !== id); emit(); }
export function pendingFor(storeId: string): PendingPurchase | undefined { return pending.find((x) => x.storeId === storeId); }

export function usePending(): PendingPurchase[] {
  const [v, setV] = useState<PendingPurchase[]>(pending);
  useEffect(() => { let a = true; void ensure().then(() => a && setV([...pending])); const f = () => a && setV([...pending]); subs.add(f); return () => { a = false; subs.delete(f); }; }, []);
  return v;
}
