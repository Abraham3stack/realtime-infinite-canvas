import { Router } from 'express';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../db/prisma.js';
import { validateBody } from '../middleware/validate.js';
import { ErrorCodes } from '@realtime-canvas/shared';

const router = Router();

// Validate the incoming displayName — shared constraints with the shared Zod schema.
const CreateGuestSchema = z.object({
  displayName: z.string().min(1).max(50).trim(),
});

// POST /auth/guest
// Creates a GuestUser and an associated GuestSession in a single transaction.
//
// Security design:
//   - 32 random bytes (256-bit entropy) are generated as the raw bearer token.
//   - Only the SHA-256 hash of that token is persisted in the database.
//   - The raw token is returned once in the response and never stored.
//   - This follows the same pattern as password-reset tokens: if the database
//     is compromised, leaked hashes cannot be replayed without the originals.
router.post('/guest', validateBody(CreateGuestSchema), async (req, res) => {
  const { displayName } = req.body as z.infer<typeof CreateGuestSchema>;

  try {
    const rawToken = randomBytes(32).toString('hex'); // 64-char hex, 256-bit entropy
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    // Atomic: if session creation fails, the user record is also rolled back.
    const [user, session] = await prisma.$transaction(async (tx) => {
      const u = await tx.guestUser.create({ data: { displayName } });
      const s = await tx.guestSession.create({
        data: { userId: u.id, sessionTokenHash: tokenHash, expiresAt },
      });
      return [u, s] as const;
    });

    res.status(201).json({
      sessionToken: rawToken,
      userId: user.id,
      displayName: user.displayName,
      sessionId: session.id,
      expiresAt: session.expiresAt.toISOString(),
    });
  } catch (err) {
    console.error('[auth] failed to create guest session:', err);
    res.status(500).json({
      code: ErrorCodes.SESSION_CREATE_FAILED,
      message: 'Failed to create guest session',
    });
  }
});

// POST /auth/validate
// Validates a bearer token and returns the associated session metadata.
// Used by the Socket.IO auth middleware (M1.D) and can be used by the client
// to verify a stored token is still live on page reload.
router.post('/validate', async (req, res) => {
  const { sessionToken } = (req.body ?? {}) as { sessionToken?: unknown };

  if (typeof sessionToken !== 'string' || sessionToken.length === 0) {
    res.status(400).json({
      code: ErrorCodes.INVALID_PAYLOAD,
      message: 'sessionToken (string) is required',
    });
    return;
  }

  const tokenHash = createHash('sha256').update(sessionToken).digest('hex');

  const session = await prisma.guestSession.findUnique({
    where: { sessionTokenHash: tokenHash },
    include: { user: true },
  });

  if (!session || session.expiresAt < new Date()) {
    res.status(401).json({
      code: ErrorCodes.SESSION_INVALID,
      message: 'Invalid or expired session',
    });
    return;
  }

  res.json({
    valid: true,
    sessionId: session.id,
    userId: session.userId,
    displayName: session.user.displayName,
    expiresAt: session.expiresAt.toISOString(),
  });
});

export default router;
