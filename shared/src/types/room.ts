// Room and participant types

export interface Room {
  id: string;
  shareCode: string;
  createdBySessionId: string;
  title?: string;
  createdAt: Date;
  updatedAt: Date;
}

export type RoomParticipantStatus = 'active' | 'idle' | 'disconnected';

export interface RoomParticipant {
  id: string;
  roomId: string;
  sessionId: string;
  joinedAt: Date;
  lastSeenAt: Date;
  isActive: boolean;
  status: RoomParticipantStatus;
  lastViewportX?: number;
  lastViewportY?: number;
  lastViewportZoom?: number;
}

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
  width?: number;
  height?: number;
}

export interface RoomState {
  room: Room;
  participants: RoomParticipant[];
  latestServerSeq: number;
}

export interface Presence {
  participantId: string;
  viewport?: Viewport;
  status: RoomParticipantStatus;
  serverTs: Date;
}
