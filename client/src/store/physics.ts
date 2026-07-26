import { create } from 'zustand';

export interface RoomPhysicsState {
  enabled: boolean;
  simulationRunning: boolean;
  gravityY: number;
  restitution: number;
  frictionAir: number;
  staticObjectIds: string[];
  resetNonce: number;
  revision: number;
}

export const DEFAULT_ROOM_PHYSICS_STATE: RoomPhysicsState = {
  enabled: false,
  simulationRunning: false,
  gravityY: 1,
  restitution: 0.75,
  frictionAir: 0.02,
  staticObjectIds: [],
  resetNonce: 0,
  revision: 1,
};

interface PhysicsState {
  roomPhysics: RoomPhysicsState;
  setRoomPhysics: (state: RoomPhysicsState) => void;
  patchRoomPhysics: (patch: Partial<RoomPhysicsState>) => void;
  clearRoomPhysics: () => void;
}

export const usePhysicsStore = create<PhysicsState>((set) => ({
  roomPhysics: { ...DEFAULT_ROOM_PHYSICS_STATE },

  setRoomPhysics: (state) => set({ roomPhysics: { ...state } }),

  patchRoomPhysics: (patch) =>
    set((current) => ({
      roomPhysics: {
        ...current.roomPhysics,
        ...patch,
      },
    })),

  clearRoomPhysics: () => set({ roomPhysics: { ...DEFAULT_ROOM_PHYSICS_STATE } }),
}));
