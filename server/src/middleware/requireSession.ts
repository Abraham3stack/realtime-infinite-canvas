import type { Request, Response, NextFunction } from 'express';
import { createHash } from 'node:crypto';
import { prisma } from '../db/prisma.js';
import { ErrorCodes } from '@realtime-canvas/shared';

// Augment the Express Request type so downstream handlers can access the
// validated session without casting. Declared here to avoid polluting global types.
export interface AuthenticatedRequest extends Request {
  session: {
    id: string;
    userId: string;
    displayName: string;
  };
}

// Express middleware that validates a Bearer token from the Authorization header.
// On success, attaches the resolved session to req.session and calls next().
// On failure, terminates the request with a 401.
// Used by room and canvas routes (M1.D+); created here so the pattern is
// established before those routes exist.
export function requireSession(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({
      code: ErrorCodes.SESSION_INVALID,
      message: 'Authorization: Bearer <token> header required',
    });
    return;
  }

  const rawToken = authHeader.slice(7);
  const tokenHash = createHash('sha256').update(rawToken).digest('hex');

  prisma.guestSession
    .findUnique({
      where: { sessionTokenHash: tokenHash },
      include: { user: true },
    })
    .then((session) => {
      if (!session || session.expiresAt < new Date()) {
        res.status(401).json({
          code: ErrorCodes.SESSION_INVALID,
          message: 'Invalid or expired session',
        });
        return;
      }

      (req as AuthenticatedRequest).session = {
        id: session.id,
        userId: session.userId,
        displayName: session.user.displayName,
      };

      next();
    })
    .catch((err: unknown) => {
      console.error('[requireSession] DB error:', err);
      res.status(500).json({
        code: ErrorCodes.INTERNAL_ERROR,
        message: 'Internal server error',
      });
    });
}
