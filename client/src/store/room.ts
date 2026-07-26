import { create } from 'zustand';

export interface RoomParticipant {
  id: string;
  roomId: string;
  sessionId?: string;
  displayName: string;
  joinedAt: string;
  lastSeenAt: string;
  isActive: boolean;
  lastViewportX?: number;
  lastViewportY?: number;
  lastViewportZoom?: number;
  lastViewportWidth?: number;
  lastViewportHeight?: number;
  presenceStatus?: 'active' | 'idle' | 'disconnected';
  presenceTs?: string;
}

export interface Room {
  id: string;
  shareCode: string;
  title: string;
  createdBySessionId?: string;
}

export interface RoomState {
  room: Room | null;
  participants: RoomParticipant[];
  setRoom: (room: Room | null) => void;
  setParticipants: (participants: RoomParticipant[]) => void;
  addParticipant: (participant: RoomParticipant) => void;
  updateParticipantPresence: (participantId: string, updates: Partial<RoomParticipant>) => void;
  removeParticipant: (participantId: string) => void;
  clearRoom: () => void;
}

/**
 * Room-scoped collaboration state.
 *
 * Participant updates are idempotent by `id` so duplicate join/refresh events
 * converge to a single participant record instead of accumulating duplicates.
 */
export const useRoomStore = create<RoomState>((set) => ({
  room: null,
  participants: [],

  setRoom: (room) => set({ room }),

  setParticipants: (participants) => set({ participants }),

  addParticipant: (participant) =>
    set((state) => ({
      participants: state.participants.some((p) => p.id === participant.id)
        ? state.participants.map((p) => (p.id === participant.id ? participant : p))
        : [...state.participants, participant],
    })),

  updateParticipantPresence: (participantId, updates) =>
    set((state) => ({
      participants: state.participants.map((participant) =>
        participant.id === participantId ? { ...participant, ...updates } : participant
      ),
    })),

  removeParticipant: (participantId) =>
    set((state) => ({
      participants: state.participants.filter((p) => p.id !== participantId),
    })),

  clearRoom: () => set({ room: null, participants: [] }),
}));
