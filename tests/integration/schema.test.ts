/**
 * Schema integration test.
 *
 * Applies the generated migration to a real PostgreSQL engine running
 * in-process (PGlite) and asserts that the structures STEP 03 promises
 * actually exist: tables, enums, foreign keys, unique constraints, indexes,
 * and the money/identifier column conventions.
 *
 * This is what verifies the DDL without needing a provisioned dev database.
 * When a real Postgres is available, `prisma migrate dev` applies the exact
 * same file.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const MIGRATIONS_DIR = join(process.cwd(), 'prisma', 'migrations');

function loadInitialMigration(): string {
  const dirs = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  if (dirs.length === 0) {
    throw new Error('No migration directories found');
  }

  return dirs
    .map((dir) => readFileSync(join(MIGRATIONS_DIR, dir, 'migration.sql'), 'utf8'))
    .join('\n');
}

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(loadInitialMigration());
}, 120_000);

afterAll(async () => {
  await db?.close();
});

async function rows<T>(sql: string): Promise<T[]> {
  const result = await db.query<T>(sql);
  return result.rows;
}

describe('migration applies cleanly', () => {
  it('creates every expected table', async () => {
    const tables = await rows<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
    );
    const names = tables.map((t) => t.tablename);

    // Spot-check one table from each domain the sign-off required.
    for (const expected of [
      'users',
      'roles',
      'user_roles',
      'sessions',
      'customer_profiles',
      'expert_profiles',
      'skills',
      'expert_skills',
      'certifications',
      'portfolio_items',
      'services',
      'service_packages',
      'availability',
      'availability_exceptions',
      'expert_verifications',
      'projects',
      'project_requirements',
      'project_skills',
      'project_documents',
      'applications',
      'recommendations',
      'assignments',
      'teams',
      'team_members',
      'contracts',
      'contract_versions',
      'milestones',
      'tasks',
      'deliverables',
      'time_entries',
      'conversations',
      'conversation_members',
      'messages',
      'attachments',
      'notifications',
      'notification_preferences',
      'orders',
      'payments',
      'payment_attempts',
      'transactions',
      'transaction_ledger',
      'commission_rules',
      'commissions',
      'refunds',
      'payouts',
      'payout_items',
      'webhook_events',
      'disputes',
      'reviews',
      'ratings',
      'expert_performance',
      'ai_agents',
      'ai_agent_versions',
      'ai_runs',
      'ai_actions',
      'audit_logs',
    ]) {
      expect(names, `missing table: ${expected}`).toContain(expected);
    }
  });

  it('creates the lifecycle enums with the approved values', async () => {
    const enumValues = async (typeName: string): Promise<string[]> => {
      const result = await rows<{ label: string }>(
        `SELECT e.enumlabel AS label
         FROM pg_enum e
         JOIN pg_type t ON t.oid = e.enumtypid
         WHERE t.typname = '${typeName}'
         ORDER BY e.enumsortorder`,
      );
      return result.map((r) => r.label);
    };

    expect(await enumValues('ProjectStatus')).toEqual([
      'DRAFT',
      'SUBMITTED',
      'AI_ANALYSIS',
      'REQUIREMENT_REVIEW',
      'MATCHING',
      'RECOMMENDED',
      'AWAITING_APPROVAL',
      'ASSIGNMENT_PENDING',
      'CONTRACT_PENDING',
      'PAYMENT_PENDING',
      'ACTIVE',
      'AT_RISK',
      'COMPLETED',
      'REVIEW_PENDING',
      'CLOSED',
      'CANCELLED',
      'DISPUTED',
      'SUSPENDED',
    ]);

    expect(await enumValues('ContractStatus')).toEqual([
      'DRAFT',
      'SENT',
      'NEGOTIATION',
      'ACCEPTED',
      'FUNDED',
      'ACTIVE',
      'COMPLETED',
      'CLOSED',
      'DECLINED',
      'CANCELLED',
      'DISPUTED',
      'TERMINATED',
    ]);

    expect(await enumValues('MilestoneStatus')).toEqual([
      'DRAFT',
      'PENDING_FUNDING',
      'FUNDED',
      'IN_PROGRESS',
      'SUBMITTED',
      'IN_REVIEW',
      'APPROVED',
      'REVISION_REQUESTED',
      'DISPUTED',
      'RESOLVED',
      'CANCELLED',
    ]);

    expect(await enumValues('PaymentStatus')).toEqual([
      'CREATED',
      'PAYMENT_INITIATED',
      'PENDING',
      'SUCCEEDED',
      'FUNDS_ALLOCATED',
      'RELEASE_PENDING',
      'RELEASED',
      'FAILED',
      'CANCELLED',
      'REFUND_REQUESTED',
      'REFUNDED',
      'PARTIALLY_REFUNDED',
      'CHARGEBACK',
    ]);

    expect(await enumValues('ProjectSource')).toEqual([
      'DIRECT_HIRE',
      'POSTED_PROJECT',
      'PREDEFINED_SERVICE',
    ]);

    expect(await enumValues('RoleName')).toEqual([
      'CUSTOMER',
      'EXPERT',
      'ADMIN',
      'SUPER_ADMIN',
      'SUPPORT',
      'FINANCE',
      'VERIFICATION_MANAGER',
    ]);
  });
});

describe('T-03 — money representation', () => {
  it('stores every monetary column as bigint', async () => {
    const moneyColumns = await rows<{ table_name: string; column_name: string; data_type: string }>(
      `SELECT table_name, column_name, data_type
       FROM information_schema.columns
       WHERE table_schema = 'public' AND column_name LIKE '%Minor'`,
    );

    expect(moneyColumns.length).toBeGreaterThan(30);
    const wrong = moneyColumns.filter((c) => c.data_type !== 'bigint');
    expect(wrong, `non-bigint money columns: ${JSON.stringify(wrong)}`).toEqual([]);
  });

  it('has no floating-point column anywhere in the schema', async () => {
    const floats = await rows<{ table_name: string; column_name: string; data_type: string }>(
      `SELECT table_name, column_name, data_type
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND data_type IN ('double precision', 'real', 'numeric')`,
    );
    expect(floats, `floating-point columns found: ${JSON.stringify(floats)}`).toEqual([]);
  });

  it('stores every currency column as CHAR(3)', async () => {
    const currencyColumns = await rows<{
      table_name: string;
      data_type: string;
      character_maximum_length: number;
    }>(
      `SELECT table_name, data_type, character_maximum_length
       FROM information_schema.columns
       WHERE table_schema = 'public' AND column_name = 'currency'`,
    );

    expect(currencyColumns.length).toBeGreaterThan(15);
    for (const column of currencyColumns) {
      expect(column.data_type).toBe('character');
      expect(column.character_maximum_length).toBe(3);
    }
  });
});

describe('T-04 — identifiers', () => {
  it('uses uuid for every primary key', async () => {
    const idColumns = await rows<{ table_name: string; data_type: string }>(
      `SELECT table_name, data_type
       FROM information_schema.columns
       WHERE table_schema = 'public' AND column_name = 'id'`,
    );

    expect(idColumns.length).toBeGreaterThan(50);
    const wrong = idColumns.filter((c) => c.data_type !== 'uuid');
    expect(wrong, `non-uuid primary keys: ${JSON.stringify(wrong)}`).toEqual([]);
  });

  it('exposes no auto-incrementing integer identifier', async () => {
    const serials = await rows<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND column_name = 'id'
         AND (is_identity = 'YES' OR column_default LIKE 'nextval%')`,
    );
    expect(serials, `sequential ids found: ${JSON.stringify(serials)}`).toEqual([]);
  });
});

describe('relational integrity', () => {
  it('declares foreign keys across the schema', async () => {
    const fks = await rows<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM information_schema.table_constraints
       WHERE table_schema = 'public' AND constraint_type = 'FOREIGN KEY'`,
    );
    expect(Number(fks[0]?.count ?? 0)).toBeGreaterThan(100);
  });

  it('stores skills relationally, never as a delimited string', async () => {
    const skillColumns = await rows<{ table_name: string; column_name: string; data_type: string }>(
      `SELECT table_name, column_name, data_type
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND column_name ILIKE '%skill%'
         AND data_type IN ('text', 'character varying')`,
    );
    expect(skillColumns, `skills stored as text: ${JSON.stringify(skillColumns)}`).toEqual([]);

    const joinTables = await rows<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('expert_skills', 'project_skills')`,
    );
    expect(joinTables).toHaveLength(2);
  });

  it('enforces the unique constraints that prevent duplicate business records', async () => {
    const uniques = await rows<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexdef LIKE 'CREATE UNIQUE%'`,
    );
    const names = uniques.map((u) => u.indexname);

    for (const expected of [
      'users_email_key',
      'expert_profiles_slug_key',
      'expert_skills_expertId_skillId_key',
      'project_skills_projectId_skillId_key',
      'applications_projectId_expertId_key',
      'contract_versions_contractId_versionNumber_key',
      'payments_idempotencyKey_key',
      'refunds_idempotencyKey_key',
      'payouts_idempotencyKey_key',
      'webhook_events_provider_providerEventId_key',
      'reviews_contractId_reviewerUserId_direction_key',
      'ratings_reviewId_dimension_key',
    ]) {
      expect(names, `missing unique index: ${expected}`).toContain(expected);
    }
  });

  it('indexes the columns the product queries by', async () => {
    const indexes = await rows<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM pg_indexes WHERE schemaname = 'public'`,
    );
    expect(Number(indexes[0]?.count ?? 0)).toBeGreaterThan(150);
  });
});

describe('financial guarantees enforced by the schema', () => {
  it('rejects a duplicate webhook event — idempotency is structural', async () => {
    await db.exec(`
      INSERT INTO "webhook_events" ("id", "provider", "providerEventId", "eventType", "payload")
      VALUES (gen_random_uuid(), 'RAZORPAY', 'evt_dup_test', 'payment.captured', '{}'::jsonb)
    `);

    await expect(
      db.exec(`
        INSERT INTO "webhook_events" ("id", "provider", "providerEventId", "eventType", "payload")
        VALUES (gen_random_uuid(), 'RAZORPAY', 'evt_dup_test', 'payment.captured', '{}'::jsonb)
      `),
    ).rejects.toThrow();
  });

  it('stores no card number, CVV or raw payment credential column', async () => {
    const forbidden = await rows<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND (
           column_name ILIKE '%cardnumber%' OR
           column_name ILIKE '%card_number%' OR
           column_name ILIKE '%cardpan%' OR
           column_name ILIKE '%cvv%' OR
           column_name ILIKE '%cvc%' OR
           column_name ILIKE '%expirymonth%' OR
           column_name ILIKE '%expiryyear%' OR
           column_name ILIKE '%securitycode%'
         )`,
    );
    expect(forbidden, `payment credential columns found: ${JSON.stringify(forbidden)}`).toEqual([]);
  });

  it('keeps the ledger append-only in shape — no updatedAt column', async () => {
    const updatedAt = await rows<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'transaction_ledger' AND column_name = 'updatedAt'`,
    );
    expect(updatedAt).toEqual([]);

    const auditUpdatedAt = await rows<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'audit_logs' AND column_name = 'updatedAt'`,
    );
    expect(auditUpdatedAt).toEqual([]);
  });

  it('supports compensating entries via a transaction self-reference', async () => {
    const reversal = await rows<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'transactions' AND column_name = 'reversalOfId'`,
    );
    expect(reversal).toHaveLength(1);
  });
});

describe('AI auditability', () => {
  it('links runs to agent, version, model and provider', async () => {
    const columns = await rows<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'ai_runs'`,
    );
    const names = columns.map((c) => c.column_name);
    for (const expected of ['agentId', 'agentVersionId', 'model', 'provider', 'costMinor', 'validationStatus']) {
      expect(names, `ai_runs missing ${expected}`).toContain(expected);
    }
  });

  it('records the human approval gate on agent actions', async () => {
    const columns = await rows<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'ai_actions'`,
    );
    const names = columns.map((c) => c.column_name);
    for (const expected of ['riskTier', 'requiresHumanApproval', 'approvedByUserId', 'policyDecision']) {
      expect(names, `ai_actions missing ${expected}`).toContain(expected);
    }
  });

  it('persists per-dimension recommendation scores for explainability', async () => {
    const columns = await rows<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'recommendations'`,
    );
    const names = columns.map((c) => c.column_name);
    for (const expected of [
      'overallScore',
      'skillScore',
      'experienceScore',
      'availabilityScore',
      'budgetFitScore',
      'ratingScore',
      'pastPerformanceScore',
      'certificationScore',
      'evidence',
      'aiRunId',
    ]) {
      expect(names, `recommendations missing ${expected}`).toContain(expected);
    }
  });
});
