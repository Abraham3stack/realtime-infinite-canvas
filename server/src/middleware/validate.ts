import type { Request, Response, NextFunction } from 'express';
import type { ZodSchema, ZodError } from 'zod';
import { ErrorCodes } from '@realtime-canvas/shared';

// Generic body validation middleware factory.
// Validates req.body against the provided Zod schema and replaces it with the
// parsed (coerced + stripped) value, so downstream handlers receive typed input.
// Returns 400 with structured field errors on failure.
export function validateBody<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      const details = (result.error as ZodError).flatten().fieldErrors;
      res.status(400).json({
        code: ErrorCodes.INVALID_PAYLOAD,
        message: 'Request validation failed',
        details,
      });
      return;
    }

    req.body = result.data;
    next();
  };
}
