/**
 * Public surface of the auth layer.
 *
 * `permissions`, `password`, `rate-limit`, `session` and `onboarding` are pure and verified by
 * execution. `service`, `current-user` and `password-hasher` touch the database and native modules, so
 * they are imported directly by server code rather than re-exported here - keeping them out of this
 * barrel means a client component cannot pull argon2 or Prisma into the browser bundle by accident.
 */

export * from './permissions.js';
export * from './password.js';
export * from './rate-limit.js';
export * from './session.js';
export * from './onboarding.js';
