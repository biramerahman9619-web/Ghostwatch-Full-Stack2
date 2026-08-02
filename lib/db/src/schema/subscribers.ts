import { pgTable, serial, varchar, timestamp } from 'drizzle-orm/pg-core';

export const guestSubscribersTable = pgTable('guest_subscribers', {
  id: serial('id').primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  name: varchar('name', { length: 255 }),
  source: varchar('source', { length: 50 }).notNull().default('portal'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type GuestSubscriber = typeof guestSubscribersTable.$inferSelect;
export type InsertGuestSubscriber = typeof guestSubscribersTable.$inferInsert;
