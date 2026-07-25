import { PrismaClient } from '@prisma/client';

// Single PrismaClient instance for the process lifetime. Prisma opens a
// connection pool on first query; creating multiple instances causes pool
// exhaustion — critical to avoid in hot-reload dev environments (tsx watch).
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? ['query', 'warn', 'error']
        : ['warn', 'error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
