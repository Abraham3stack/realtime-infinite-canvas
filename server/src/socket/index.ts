import type { Server } from 'socket.io';
import { authMiddleware } from './middleware/auth.js';
import { registerRoomHandlers } from './handlers/room.js';

export function registerSocketHandlers(io: Server): void {
  // Auth middleware: validates bearer token before allowing connection.
  // After this, socket.sessionId, socket.userId, socket.displayName are available.
  io.use(authMiddleware);

  // Register all room lifecycle handlers.
  registerRoomHandlers(io);
}
