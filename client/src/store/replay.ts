import { create } from 'zustand';
import {
  createReplayStore,
  type ReplayState,
  type ReplayStore,
  type RoomEvent,
} from '@realtime-canvas/shared';

interface ReplayStoreState {
  engine: ReplayStore;
  currentState: ReplayState;
  eventCount: number;
  initialize: (events: RoomEvent[]) => void;
  stepForward: () => ReplayState;
  stepBackward: () => ReplayState;
  seek: (position: number) => ReplayState;
  reset: () => ReplayState;
  getCurrentState: () => ReplayState;
}

function buildReplayEngine(): { engine: ReplayStore; initialState: ReplayState } {
  const engine = createReplayStore();
  const initialState = engine.getCurrentState();
  return { engine, initialState };
}

const { engine: initialEngine, initialState } = buildReplayEngine();

export const useReplayStore = create<ReplayStoreState>((set, get) => ({
  engine: initialEngine,
  currentState: initialState,
  eventCount: 0,

  initialize: (events) => {
    const nextEngine = createReplayStore();
    nextEngine.initialize(events);
    const currentState = nextEngine.getCurrentState();

    set({
      engine: nextEngine,
      currentState,
      eventCount: events.length,
    });
  },

  stepForward: () => {
    const state = get().engine.stepForward();
    set({ currentState: state });
    return state;
  },

  stepBackward: () => {
    const state = get().engine.stepBackward();
    set({ currentState: state });
    return state;
  },

  seek: (position) => {
    const { engine, eventCount } = get();
    const target = Math.max(0, Math.min(eventCount, Math.trunc(position)));

    engine.reset();
    for (let index = 0; index < target; index += 1) {
      engine.stepForward();
    }

    const state = engine.getCurrentState();
    set({ currentState: state });
    return state;
  },

  reset: () => {
    const state = get().engine.reset();
    set({ currentState: state });
    return state;
  },

  getCurrentState: () => get().currentState,
}));
