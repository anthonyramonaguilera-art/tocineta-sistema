import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const systemMeta = sqliteTable('_system_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAtMs: integer('updated_at_ms').notNull()
});

export const migrationsTable = sqliteTable('_migrations', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  appliedAtMs: integer('applied_at_ms').notNull()
});

export const UserRoleValues = ['admin', 'supervisor', 'cajera', 'mesonero', 'cocinero', 'despachador'] as const;
export type UserRole = (typeof UserRoleValues)[number];

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  role: text('role', { enum: UserRoleValues }).notNull(),
  pinHash: text('pin_hash').notNull(),
  pinSalt: text('pin_salt').notNull(),
  pinLength: integer('pin_length').notNull(), // 4 o 6
  mustChangePin: integer('must_change_pin').notNull().default(0),
  isActive: integer('is_active').notNull().default(1),
  failedAttempts: integer('failed_attempts').notNull().default(0),
  lockoutStage: integer('lockout_stage').notNull().default(0),
  lockedUntilMs: integer('locked_until_ms'),
  createdAtMs: integer('created_at_ms').notNull(),
  updatedAtMs: integer('updated_at_ms').notNull()
});

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  role: text('role', { enum: UserRoleValues }).notNull(),
  createdAtMs: integer('created_at_ms').notNull(),
  expiresAtMs: integer('expires_at_ms').notNull(),
  lastActivityMs: integer('last_activity_ms').notNull(),
  sensitiveUnlockedUntilMs: integer('sensitive_unlocked_until_ms'),
  revokedAtMs: integer('revoked_at_ms')
});

export const auditEvents = sqliteTable('audit_events', {
  seq: integer('seq').primaryKey({ autoIncrement: true }),
  eventId: text('event_id').notNull().unique(),
  actorUserId: text('actor_user_id').references(() => users.id),
  authorizerUserId: text('authorizer_user_id').references(() => users.id),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  payloadJson: text('payload_json').notNull(),
  createdAtMs: integer('created_at_ms').notNull(),
  prevHash: text('prev_hash').notNull(),
  entryHash: text('entry_hash').notNull().unique()
});

export const idempotencyKeys = sqliteTable('idempotency_keys', {
  idempotencyKey: text('idempotency_key').primaryKey(),
  method: text('method').notNull(),
  route: text('route').notNull(),
  requestHash: text('request_hash').notNull(),
  statusCode: integer('status_code').notNull(),
  responseJson: text('response_json').notNull(),
  createdAtMs: integer('created_at_ms').notNull(),
  expiresAtMs: integer('expires_at_ms').notNull()
});

export type SystemMeta = typeof systemMeta.$inferSelect;
export type InsertSystemMeta = typeof systemMeta.$inferInsert;
export type MigrationRecord = typeof migrationsTable.$inferSelect;
export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type InsertSession = typeof sessions.$inferInsert;
export type AuditEvent = typeof auditEvents.$inferSelect;
export type InsertAuditEvent = typeof auditEvents.$inferInsert;
export type IdempotencyRecord = typeof idempotencyKeys.$inferSelect;
export type InsertIdempotencyRecord = typeof idempotencyKeys.$inferInsert;

export function mapUserRow(row: any): User {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    pinHash: row.pin_hash ?? row.pinHash,
    pinSalt: row.pin_salt ?? row.pinSalt,
    pinLength: row.pin_length ?? row.pinLength,
    mustChangePin: row.must_change_pin ?? row.mustChangePin ?? 0,
    isActive: row.is_active ?? row.isActive ?? 1,
    failedAttempts: row.failed_attempts ?? row.failedAttempts ?? 0,
    lockoutStage: row.lockout_stage ?? row.lockoutStage ?? 0,
    lockedUntilMs: row.locked_until_ms ?? row.lockedUntilMs ?? null,
    createdAtMs: row.created_at_ms ?? row.createdAtMs,
    updatedAtMs: row.updated_at_ms ?? row.updatedAtMs
  };
}

export function mapSessionRow(row: any): Session {
  return {
    id: row.id,
    userId: row.user_id ?? row.userId,
    tokenHash: row.token_hash ?? row.tokenHash,
    role: row.role,
    createdAtMs: row.created_at_ms ?? row.createdAtMs,
    expiresAtMs: row.expires_at_ms ?? row.expiresAtMs,
    lastActivityMs: row.last_activity_ms ?? row.lastActivityMs,
    sensitiveUnlockedUntilMs: row.sensitive_unlocked_until_ms ?? row.sensitiveUnlockedUntilMs ?? null,
    revokedAtMs: row.revoked_at_ms ?? row.revokedAtMs ?? null
  };
}

