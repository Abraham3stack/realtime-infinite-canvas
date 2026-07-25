import { create } from 'zustand';

export interface RoomParticipant {
  id: string;
  roomId: string;
  displayName: string;
  joinedAt: string;
  lastSeenAt: string;
  isActive: boolean;
}

export interface Room {
  id: string;
  shareCode: string;
  title: string;
}

export interface RoomState {
  room: Room | null;
  participants: RoomParticipant[];
  setRoom: (room: Room | null) => void;
  setParticipants: (participants: RoomParticipant[]) => void;
  addParticipant: (participant: RoomParticipant) => void;
  removeParticipant: (participantId: string) => void;
  clearRoom: () => void;
}

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

  removeParticipant: (participantId) =>
    set((state) => ({
      participants: state.participants.filter((p) => p.id !== participantId),
    })),

  clearRoom: () => set({ room: null, participants: [] }),
}));
