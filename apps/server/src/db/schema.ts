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

export type SystemMeta = typeof systemMeta.$inferSelect;
export type InsertSystemMeta = typeof systemMeta.$inferInsert;
export type MigrationRecord = typeof migrationsTable.$inferSelect;
