import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import type {
  AccessLevel,
  AlgoWeights,
  CommentStatus,
  OrderSource,
  OrderStatus,
  RedeemCodeStatus,
  StorageDriver,
  SubscriptionStatus,
  TranscodeJobStatus,
  UserRole,
  UserStatus,
  VideoKind,
  VideoStatus,
  VideoVisibility,
} from '@videox/shared';

const now = sql`now()`;

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(now),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(now),
};
