import type { Server } from 'socket.io';
import { authMiddleware } from './middleware/auth.js';
import { registerRoomHandlers } from './handlers/room.js';
import { registerRoomEventHandlers } from './handlers/roomEvents.js';
import { registerObjectHandlers } from './handlers/objects.js';
import { registerPhysicsHandlers } from './handlers/physics.js';
import { registerPresenceHandlers } from './handlers/presence.js';

/**
 * Attaches all Socket.IO middleware and domain handlers.
 *
 * Registration order is intentional: authentication runs first so downstream
 * handlers can trust `AuthenticatedSocket` metadata.
 */
export function registerSocketHandlers(io: Server): void {
  // Auth middleware: validates bearer token before allowing connection.
  // After this, socket.sessionId, socket.userId, socket.displayName are available.
  io.use(authMiddleware);

  // Register all room lifecycle handlers.
  registerRoomHandlers(io);

  // Register room event journal query handlers.
  registerRoomEventHandlers(io);

  // Register all object synchronization handlers.
  registerObjectHandlers(io);

  // Register room-scoped physics state synchronization handlers.
  registerPhysicsHandlers(io);

  // Register collaborator presence/radar viewport synchronization handlers.
  registerPresenceHandlers(io);
}
