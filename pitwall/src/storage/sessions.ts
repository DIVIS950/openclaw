import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CompletedLap, StartFinishLine } from '../lap/LapTimer';
import type { SourceKind } from '../telemetry/types';

/**
 * A lap as stored on the phone: one array per channel ("columns"), sampled at
 * 12.5 Hz. Compact as JSON and easy to plot.
 */
export interface LapTrace {
  t: number[]; // ms into lap
  d: number[]; // metres into lap
  lat: number[];
  lon: number[];
  v: number[]; // km/h
  tfl: number[];
  tfr: number[];
  trl: number[];
  trr: number[];
  bfl: number[];
  bfr: number[];
  coolant: number[];
  oil: number[];
  egt: number[];
}

export interface SavedLap {
  number: number;
  timeMs: number;
  sectorsMs: [number, number, number];
  distanceM: number;
  maxKmh: number;
  trace: LapTrace;
}

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

/** Store every 2nd frame: 12.5 Hz is plenty for maps and graphs. */
const KEEP_EVERY = 2;

const r1 = (n: number) => Math.round(n * 10) / 10;
const r7 = (n: number) => Math.round(n * 1e7) / 1e7;

export function lapToSaved(lap: CompletedLap): SavedLap {
  const tr: LapTrace = { t: [], d: [], lat: [], lon: [], v: [], tfl: [], tfr: [], trl: [], trr: [], bfl: [], bfr: [], coolant: [], oil: [], egt: [] };
  const n = lap.frames.length;
  let maxKmh = 0;
  for (let i = 0; i < n; i++) {
    const f = lap.frames[i];
    maxKmh = Math.max(maxKmh, f.speedKmh);
    if (i % KEEP_EVERY !== 0 && i !== n - 1) continue;
    tr.t.push(Math.round(lap.lapT[i]));
    tr.d.push(r1(lap.lapD[i]));
    tr.lat.push(r7(f.lat));
    tr.lon.push(r7(f.lon));
    tr.v.push(r1(f.speedKmh));
    tr.tfl.push(r1(f.tyre.fl));
    tr.tfr.push(r1(f.tyre.fr));
    tr.trl.push(r1(f.tyre.rl));
    tr.trr.push(r1(f.tyre.rr));
    tr.bfl.push(Math.round(f.brake.fl));
    tr.bfr.push(Math.round(f.brake.fr));
    tr.coolant.push(r1(f.coolant));
    tr.oil.push(r1(f.oil));
    tr.egt.push(Math.round(f.egt));
  }
  return {
    number: lap.number,
    timeMs: Math.round(lap.timeMs),
    sectorsMs: lap.sectorsMs.map(Math.round) as [number, number, number],
    distanceM: r1(lap.distanceM),
    maxKmh: r1(maxKmh),
    trace: tr,
  };
}

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
