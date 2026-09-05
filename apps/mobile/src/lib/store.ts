/** The shopping list, persisted on the device between sessions. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ListLine } from '@fca/domain';

export type Line = Omit<ListLine, 'id'> & { id: string; imageUrl?: string | null; productName?: string };
const KEY = 'fca.list';

export async function loadList(): Promise<Line[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Line[]) : [];
  } catch {
    return [];
  }
}
export async function saveList(lines: Line[]): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(lines));
}
export const newId = (): string => Math.random().toString(36).slice(2, 10);
