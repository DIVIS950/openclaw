/**
 * The live session: owns the data source, lap timer, warnings and recording.
 * Frames arrive at 25 Hz and are all processed here; the UI store is only
 * updated ~12 times a second so React stays smooth.
 */
import * as Haptics from 'expo-haptics';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { Vibration } from 'react-native';
import { create } from 'zustand';
import { LapTimer, type LapTimerState, type StartFinishLine } from '../lap/LapTimer';
import { lapToSaved, saveSession, type SavedLap, type SavedSession } from '../storage/sessions';
import { createSource, type SourceKind, type SourceStatus, type TelemetryFrame, type TelemetrySource } from '../telemetry';
import { useSettings, type Limits, type TempChannel } from './settings';

export type WarningKey = TempChannel | 'battLow' | 'test';

export interface ActiveWarning {
  key: WarningKey;
  label: string;
  value: number;
  limit: number;
}

interface LiveState {
  running: boolean;
  sourceKind: SourceKind;
  status: SourceStatus;
  statusMessage?: string;
  sessionId: string | null;
  frame: TelemetryFrame | null;
  timer: LapTimerState;
  laps: SavedLap[];
  /** Current lap's path so far, ~5 Hz, for the track map. */
  trail: { lat: number[]; lon: number[] };
  line: StartFinishLine | null;
  warnings: ActiveWarning[];
  start: () => Promise<void>;
  stop: () => Promise<void>;
  setStartFinishHere: () => void;
  testWarning: () => void;
}

const EMPTY_TIMER: LapTimerState = {
  lapNumber: 0,
  lapStartT: null,
  currentMs: 0,
  distanceM: 0,
  deltaMs: null,
  bestMs: null,
  lastMs: null,
  currentSectors: [null, null, null],
  sectorSplitsM: null,
};

// ── Engine state (not React state) ─────────────────────────────────────
let source: TelemetrySource | null = null;
let timer: LapTimer | null = null;
let session: SavedSession | null = null;
let lastFrame: TelemetryFrame | null = null;
let unsubs: (() => void)[] = [];
let frameCount = 0;
let trail = { lat: [] as number[], lon: [] as number[] };
const active = new Map<WarningKey, ActiveWarning>();
let saveChain: Promise<void> = Promise.resolve();

/** How far a value must fall back below its limit before the warning clears. */
const HYSTERESIS: Record<keyof Limits, number> = { tyre: 3, brake: 25, coolant: 2, oil: 2, egt: 25, battLow: 0.2 };
const LABEL: Record<WarningKey, string> = {
  tyre: 'TYRE TEMP',
  brake: 'BRAKE TEMP',
  coolant: 'COOLANT',
  oil: 'OIL TEMP',
  egt: 'EGT',
  battLow: 'BATTERY LOW',
  test: 'TEST ALARM',
};

function alarm() {
  if (!useSettings.getState().haptics) return;
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
  Vibration.vibrate([0, 400, 150, 400]);
}

/** Highest valid reading among several sensors (NaN = sensor missing). */
const maxOf = (...xs: number[]) => {
  const ok = xs.filter(Number.isFinite);
  return ok.length ? Math.max(...ok) : NaN;
};

/** Returns true when the set of active warnings changed. */
function checkWarnings(f: TelemetryFrame): boolean {
  const { limits, sensors } = useSettings.getState();
  const readings: [TempChannel, number][] = [
    ['tyre', maxOf(f.tyre.fl, f.tyre.fr, f.tyre.rl, f.tyre.rr)],
    ['brake', maxOf(f.brake.fl, f.brake.fr)],
    ['coolant', f.coolant],
    ['oil', f.oil],
    ['egt', f.egt],
  ];
  let changed = false;
  let fire = false;
  for (const [key, value] of readings) {
    const on = active.has(key);
    if (!sensors[key] || !Number.isFinite(value)) {
      if (on) changed = active.delete(key);
      continue;
    }
    if (value > limits[key]) {
      if (!on) fire = true;
      active.set(key, { key, label: LABEL[key], value, limit: limits[key] });
      changed ||= !on;
    } else if (on && value < limits[key] - HYSTERESIS[key]) {
      changed = active.delete(key);
    } else if (on) {
      active.set(key, { ...active.get(key)!, value });
    }
  }
  // Battery warns when it drops BELOW the limit.
  if (Number.isFinite(f.battV)) {
    const on = active.has('battLow');
    if (f.battV < limits.battLow) {
      if (!on) fire = changed = true;
      active.set('battLow', { key: 'battLow', label: LABEL.battLow, value: f.battV, limit: limits.battLow });
    } else if (on && f.battV > limits.battLow + HYSTERESIS.battLow) {
      changed = active.delete('battLow');
    }
  }
  if (fire) alarm();
  return changed;
}

function persist() {
  if (!session || session.laps.length === 0) return;
  const copy = { ...session, laps: [...session.laps] };
  // Writes are chained so two laps never write at the same time.
  saveChain = saveChain.then(() => saveSession(copy)).catch((e) => console.warn('Saving session failed', e));
}

function onFrame(f: TelemetryFrame) {
  if (!timer) return;
  lastFrame = f;
  frameCount++;
  const lap = timer.push(f);

  // Remember an auto-placed or moved start/finish line for next time.
  const line = timer.getLine();
  if (line && line !== useSettings.getState().startFinish) useSettings.getState().set({ startFinish: line });

  if (frameCount % 5 === 0 || lap) {
    trail.lat.push(f.lat);
    trail.lon.push(f.lon);
  }
  if (lap && session) {
    session.laps.push(lapToSaved(lap));
    trail = { lat: [f.lat], lon: [f.lon] };
    persist();
  }

  const warningsChanged = checkWarnings(f);
  // Publish to React at 12.5 Hz, or straight away when something important happened.
  if (frameCount % 2 === 0 || lap || warningsChanged) {
    useLive.setState({
      frame: f,
      timer: timer.state(),
      line: timer.getLine(),
      trail: { lat: [...trail.lat], lon: [...trail.lon] },
      ...(lap && session ? { laps: [...session.laps] } : {}),
      ...(warningsChanged ? { warnings: [...active.values()] } : {}),
    });
  }
}

export const useLive = create<LiveState>()((set, get) => ({
  running: false,
  sourceKind: 'simulator',
  status: 'disconnected',
  sessionId: null,
  frame: null,
  timer: EMPTY_TIMER,
  laps: [],
  trail: { lat: [], lon: [] },
  line: null,
  warnings: [],

  start: async () => {
    if (get().running) return;
    const settings = useSettings.getState();
    const kind = settings.source;
    source = createSource(kind);
    timer = new LapTimer(settings.startFinish);
    const startedAt = Date.now();
    session = { id: String(startedAt), startedAt, source: kind, lapCount: 0, bestMs: null, startFinish: settings.startFinish, laps: [] };
    frameCount = 0;
    lastFrame = null;
    trail = { lat: [], lon: [] };
    active.clear();

    unsubs = [
      source.onFrame(onFrame),
      source.onStatus((status, message) => {
        set({ status, statusMessage: message });
        // A failed connection ends the session straight away.
        if (status === 'error') get().stop();
      }),
    ];
    set({
      running: true,
      sourceKind: kind,
      sessionId: session.id,
      frame: null,
      timer: EMPTY_TIMER,
      laps: [],
      trail: { lat: [], lon: [] },
      line: settings.startFinish,
      warnings: [],
    });
    activateKeepAwakeAsync('session').catch(() => {});
    await source.connect();
  },

  stop: async () => {
    const src = source;
    source = null;
    if (session) session.startFinish = timer?.getLine() ?? null;
    persist();
    unsubs.forEach((u) => u());
    unsubs = [];
    // Keep the error message visible if the stop was caused by an error.
    const { status, statusMessage } = get();
    set({ running: false, warnings: [], ...(status === 'error' ? { status, statusMessage } : { status: 'disconnected', statusMessage: undefined }) });
    active.clear();
    deactivateKeepAwake('session').catch(() => {});
    await src?.disconnect();
    timer = null;
  },

  setStartFinishHere: () => {
    if (!timer || !lastFrame) return;
    timer.setLineHere(lastFrame);
    trail = { lat: [lastFrame.lat], lon: [lastFrame.lon] };
    useSettings.getState().set({ startFinish: timer.getLine() });
    set({ timer: timer.state(), line: timer.getLine(), trail: { ...trail } });
  },

  testWarning: () => {
    active.set('test', { key: 'test', label: LABEL.test, value: 0, limit: 0 });
    set({ warnings: [...active.values()] });
    alarm();
    setTimeout(() => {
      active.delete('test');
      useLive.setState({ warnings: [...active.values()] });
    }, 4000);
  },
}));
