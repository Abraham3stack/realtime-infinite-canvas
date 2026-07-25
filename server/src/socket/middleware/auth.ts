import type { Socket } from 'socket.io';
import { createHash } from 'node:crypto';
import { prisma } from '../../db/prisma.js';
import { ErrorCodes } from '@realtime-canvas/shared';
import type { AuthenticatedSocket } from '../types.js';

// Socket.IO auth middleware. Validates the Bearer token in the handshake auth object.
// On success, attaches session metadata to socket and continues to connection.
// On failure, rejects the connection with an error so the client knows immediately.
export async function authMiddleware(
  socket: Socket,
  next: (err?: Error) => void
): Promise<void> {
  const token = (socket.handshake.auth?.token ?? '') as string;

  if (!token) {
    next(new Error(ErrorCodes.SESSION_INVALID));
    return;
  }

  const tokenHash = createHash('sha256').update(token).digest('hex');

  const session = await prisma.guestSession
    .findUnique({
      where: { sessionTokenHash: tokenHash },
      include: { user: true },
    })
    .catch((err: unknown) => {
      console.error('[socket auth] DB error:', err);
      return null;
    });

  if (!session || session.expiresAt < new Date()) {
    next(new Error(ErrorCodes.SESSION_INVALID));
    return;
  }

  // Attach session to the socket so room handlers can access it.
  const authSocket = socket as AuthenticatedSocket;
  authSocket.sessionId = session.id;
  authSocket.userId = session.userId;
  authSocket.displayName = session.user.displayName;

  next();
}
