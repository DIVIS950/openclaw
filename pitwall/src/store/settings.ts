import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { StartFinishLine } from '../lap/LapTimer';
import type { SourceKind } from '../telemetry/types';

/** Every temperature channel that can raise a warning. */
export type TempChannel = 'tyre' | 'brake' | 'coolant' | 'oil' | 'egt';

export interface Limits {
  tyre: number;
  brake: number;
  coolant: number;
  oil: number;
  egt: number;
  /** Warn when the battery drops BELOW this. */
  battLow: number;
}

export const DEFAULT_LIMITS: Limits = { tyre: 110, brake: 720, coolant: 105, oil: 120, egt: 950, battLow: 12.0 };

/** Ranges the limit steppers allow, and their step size. */
export const LIMIT_RANGE: Record<keyof Limits, { min: number; max: number; step: number }> = {
  tyre: { min: 60, max: 150, step: 1 },
  brake: { min: 300, max: 1000, step: 10 },
  coolant: { min: 80, max: 130, step: 1 },
  oil: { min: 80, max: 150, step: 1 },
  egt: { min: 600, max: 1100, step: 10 },
  battLow: { min: 10, max: 14, step: 0.1 },
};

export type Units = 'metric' | 'imperial';

interface SettingsState {
  source: SourceKind;
  units: Units;
  limits: Limits;
  sensors: Record<TempChannel, boolean>;
  haptics: boolean;
  /** Saved start/finish line; null = set it automatically where the session starts. */
  startFinish: StartFinishLine | null;
  set: (patch: Partial<Omit<SettingsState, 'set' | 'setLimit' | 'toggleSensor' | 'resetDefaults'>>) => void;
  setLimit: (key: keyof Limits, value: number) => void;
  toggleSensor: (key: TempChannel) => void;
  resetDefaults: () => void;
}

const defaults = {
  source: 'simulator' as SourceKind,
  units: 'metric' as Units,
  limits: DEFAULT_LIMITS,
  sensors: { tyre: true, brake: true, coolant: true, oil: true, egt: true },
  haptics: true,
  startFinish: null,
};

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      ...defaults,
      set: (patch) => set(patch),
      setLimit: (key, value) => {
        const r = LIMIT_RANGE[key];
        const clamped = Math.min(r.max, Math.max(r.min, Math.round(value / r.step) * r.step));
        set((s) => ({ limits: { ...s.limits, [key]: Number(clamped.toFixed(1)) } }));
      },
      toggleSensor: (key) => set((s) => ({ sensors: { ...s.sensors, [key]: !s.sensors[key] } })),
      resetDefaults: () => set({ limits: DEFAULT_LIMITS, sensors: defaults.sensors, units: 'metric', haptics: true }),
    }),
    { name: 'pitwall:settings', storage: createJSONStorage(() => AsyncStorage), version: 1 },
  ),
);
