import { PrismaClient } from '@prisma/client';

/**
 * Prisma client singleton.
 *
 * Next.js reloads modules in development, and a new client per reload exhausts the connection pool
 * within a few edits, so the instance is cached on `globalThis` outside production.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db;
