import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, type Dispatch, type ReactNode, use, useEffect, useReducer } from 'react';

import { type Action, type AppState, initialState, reducer } from './reducer';

const STORAGE_KEY = 'onecart/state/v1';

const StateContext = createContext<{ state: AppState; dispatch: Dispatch<Action> } | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => dispatch({ type: 'hydrate', state: raw ? (JSON.parse(raw) as Partial<AppState>) : {} }))
      .catch(() => dispatch({ type: 'hydrate', state: {} }));
  }, []);

  useEffect(() => {
    // Don't overwrite saved data with the empty initial state before it loads.
    if (!state.hydrated) return;
    const { hydrated: _hydrated, ...persisted } = state;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(persisted)).catch(() => {});
  }, [state]);

  return <StateContext value={{ state, dispatch }}>{children}</StateContext>;
}

export function useAppState() {
  const ctx = use(StateContext);
  if (!ctx) throw new Error('useAppState must be used inside AppStateProvider');
  return ctx;
}
