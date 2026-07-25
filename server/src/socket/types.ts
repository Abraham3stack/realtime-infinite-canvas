import type { Socket as SocketIOSocket } from 'socket.io';

// Extended Socket interface with application-specific properties.
export interface AuthenticatedSocket extends SocketIOSocket {
  sessionId?: string;
  userId?: string;
  displayName?: string;
  roomId?: string;
}
