import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

// One versioned club document makes round publication and rating corrections atomic.
export const clubState = sqliteTable('club_state', {
  id: text('id').primaryKey(),
  version: integer('version').notNull(),
  document: text('document').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const accounts = sqliteTable('auth_accounts', {
  id: text('id').primaryKey(),
  username: text('username').notNull().unique(),
  memberId: text('member_id').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  active: integer('active').notNull().default(1),
  createdAt: integer('created_at').notNull(),
});
export const sessions = sqliteTable('auth_sessions', {
  tokenHash: text('token_hash').primaryKey(),
  accountId: text('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  expiresAt: integer('expires_at').notNull(),
});
export const loginAttempts = sqliteTable('auth_attempts', {
  key: text('key').primaryKey(),
  count: integer('count').notNull(),
  windowStart: integer('window_start').notNull(),
});
