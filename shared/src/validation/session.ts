// Session validation schemas

import { z } from 'zod';

export const GuestUserSchema = z.object({
  id: z.string().uuid(),
  displayName: z.string().min(1).max(50),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const GuestSessionSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  sessionToken: z.string().min(32),
  expiresAt: z.date(),
  createdAt: z.date(),
});

export const AuthResponseSchema = z.object({
  sessionToken: z.string().min(32),
  userId: z.string().uuid(),
  displayName: z.string().min(1).max(50),
});

export type GuestUser = z.infer<typeof GuestUserSchema>;
export type GuestSession = z.infer<typeof GuestSessionSchema>;
export type AuthResponse = z.infer<typeof AuthResponseSchema>;
