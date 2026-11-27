import AsyncStorage from '@react-native-async-storage/async-storage';
import type { StartFinishLine } from '../lap/LapTimer';
import type { SavedLap } from '../lap/record';
import type { SourceKind } from '../telemetry/types';

export { lapToSaved, type LapTrace, type SavedLap } from '../lap/record';

export interface SessionSummary {
  id: string;
  startedAt: number;
  source: SourceKind;
  lapCount: number;
  bestMs: number | null;
}

export interface SavedSession extends SessionSummary {
  startFinish: StartFinishLine | null;
  laps: SavedLap[];
}

const INDEX_KEY = 'pitwall:sessions';
const sessionKey = (id: string) => `pitwall:session:${id}`;

export function summarize(s: SavedSession): SessionSummary {
  const best = s.laps.length ? Math.min(...s.laps.map((l) => l.timeMs)) : null;
  return { id: s.id, startedAt: s.startedAt, source: s.source, lapCount: s.laps.length, bestMs: best };
}

export async function listSessions(): Promise<SessionSummary[]> {
  try {
    const raw = await AsyncStorage.getItem(INDEX_KEY);
    const list: SessionSummary[] = raw ? JSON.parse(raw) : [];
    return list.sort((a, b) => b.startedAt - a.startedAt);
  } catch {
    return [];
  }
}

export async function loadSession(id: string): Promise<SavedSession | null> {
  const raw = await AsyncStorage.getItem(sessionKey(id));
  return raw ? (JSON.parse(raw) as SavedSession) : null;
}

export async function saveSession(session: SavedSession): Promise<void> {
  await AsyncStorage.setItem(sessionKey(session.id), JSON.stringify(session));
  const list = (await listSessions()).filter((s) => s.id !== session.id);
  list.push(summarize(session));
  await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(list));
}

export async function deleteSession(id: string): Promise<void> {
  await AsyncStorage.removeItem(sessionKey(id));
  const list = (await listSessions()).filter((s) => s.id !== id);
  await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(list));
}
