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

import { ROLE_NAMES, ROLE_PERMISSIONS } from '../../lib/authz/roles.js';

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

describe('application code stays in sync with the database', () => {
  it('RoleName union matches the RoleName enum exactly', async () => {
    // lib/authz/roles.ts declares the roles the application reasons about.
    // If someone adds a role to the schema and forgets the permission matrix
    // (or vice versa), this fails instead of shipping a role with no rules.
    const dbRoles = await rows<{ label: string }>(
      `SELECT e.enumlabel AS label
       FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
       WHERE t.typname = 'RoleName'
       ORDER BY e.enumsortorder`,
    );
    expect(dbRoles.map((r) => r.label)).toEqual([...ROLE_NAMES]);
  });

  it('every database role has a non-empty permission set', async () => {
    const dbRoles = await rows<{ label: string }>(
      `SELECT e.enumlabel AS label FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
       WHERE t.typname = 'RoleName'`,
    );
    for (const { label } of dbRoles) {
      const permissions = ROLE_PERMISSIONS[label as (typeof ROLE_NAMES)[number]];
      expect(permissions, `role ${label} has no permission set`).toBeDefined();
      expect(permissions.length, `role ${label} has an empty permission set`).toBeGreaterThan(0);
    }
  });
});

describe('CHECK constraints (D-05 hardening)', () => {
  /** Asserts a statement is rejected by the database, not merely by the app. */
  async function mustReject(sql: string): Promise<void> {
    await expect(db.exec(sql)).rejects.toThrow();
  }

  it('adds CHECK constraints to the database', async () => {
    const checks = await rows<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM pg_constraint
       WHERE contype = 'c' AND connamespace = 'public'::regnamespace
         AND conname NOT LIKE '%_not_null'`,
    );
    expect(Number(checks[0]?.count ?? 0)).toBeGreaterThanOrEqual(50);
  });

  it('enforces Project source ↔ relationship semantics (A-01)', async () => {
    const setup = `
      INSERT INTO "categories" ("id","name","slug","updatedAt")
        VALUES ('11111111-1111-1111-1111-111111111111','Cat','cat-chk', now());
      INSERT INTO "users" ("id","email","fullName","updatedAt")
        VALUES ('22222222-2222-2222-2222-222222222222','chk@example.test','Chk User', now());
      INSERT INTO "customer_profiles" ("id","userId","updatedAt")
        VALUES ('33333333-3333-3333-3333-333333333333','22222222-2222-2222-2222-222222222222', now());
      INSERT INTO "users" ("id","email","fullName","updatedAt")
        VALUES ('44444444-4444-4444-4444-444444444444','chkexp@example.test','Chk Expert', now());
      INSERT INTO "expert_profiles" ("id","userId","slug","updatedAt")
        VALUES ('55555555-5555-5555-5555-555555555555','44444444-4444-4444-4444-444444444444','chk-expert', now());
      INSERT INTO "services" ("id","expertId","categoryId","title","slug","description","basePriceMinor","currency","deliveryDays","updatedAt")
        VALUES ('66666666-6666-6666-6666-666666666666','55555555-5555-5555-5555-555555555555','11111111-1111-1111-1111-111111111111','S','s-chk','d',100,'INR',5, now());
    `;
    await db.exec(setup);

    // A POSTED_PROJECT must not carry a service link.
    await mustReject(`
      INSERT INTO "projects" ("id","projectNumber","customerId","source","title","description","currency","serviceId","updatedAt")
      VALUES (gen_random_uuid(),'PRJ-CHK-1','33333333-3333-3333-3333-333333333333','POSTED_PROJECT','t','d','INR','66666666-6666-6666-6666-666666666666', now())
    `);

    // A POSTED_PROJECT must not carry an invited-expert link.
    await mustReject(`
      INSERT INTO "projects" ("id","projectNumber","customerId","source","title","description","currency","invitedExpertId","updatedAt")
      VALUES (gen_random_uuid(),'PRJ-CHK-2','33333333-3333-3333-3333-333333333333','POSTED_PROJECT','t','d','INR','55555555-5555-5555-5555-555555555555', now())
    `);

    // But the legitimate combinations must still be accepted, and a
    // PREDEFINED_SERVICE project with no service link yet must remain valid —
    // the constraint must not make a real workflow state impossible.
    await db.exec(`
      INSERT INTO "projects" ("id","projectNumber","customerId","source","title","description","currency","serviceId","updatedAt")
      VALUES (gen_random_uuid(),'PRJ-CHK-3','33333333-3333-3333-3333-333333333333','PREDEFINED_SERVICE','t','d','INR','66666666-6666-6666-6666-666666666666', now());

      INSERT INTO "projects" ("id","projectNumber","customerId","source","title","description","currency","updatedAt")
      VALUES (gen_random_uuid(),'PRJ-CHK-4','33333333-3333-3333-3333-333333333333','PREDEFINED_SERVICE','t','d','INR', now());

      INSERT INTO "projects" ("id","projectNumber","customerId","source","title","description","currency","invitedExpertId","updatedAt")
      VALUES (gen_random_uuid(),'PRJ-CHK-5','33333333-3333-3333-3333-333333333333','DIRECT_HIRE','t','d','INR','55555555-5555-5555-5555-555555555555', now());

      INSERT INTO "projects" ("id","projectNumber","customerId","source","title","description","currency","updatedAt")
      VALUES (gen_random_uuid(),'PRJ-CHK-6','33333333-3333-3333-3333-333333333333','POSTED_PROJECT','t','d','INR', now());
    `);

    const accepted = await rows<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM "projects" WHERE "projectNumber" LIKE 'PRJ-CHK-%'`,
    );
    expect(Number(accepted[0]?.count ?? 0)).toBe(4);
  });

  it('enforces financial arithmetic identities', async () => {
    await db.exec(`
      INSERT INTO "commission_rules" ("id","name","calculationType","percentageBasisPoints","version","effectiveFrom","updatedAt")
      VALUES ('77777777-7777-7777-7777-777777777777','Chk Rule','PERCENTAGE',1000,1, now(), now())
    `);

    // gross must equal commission + payable
    await mustReject(`
      INSERT INTO "commissions" ("id","commissionRuleId","commissionRuleVersion","grossAmountMinor","commissionAmountMinor","expertPayableMinor","currency","calculationSnapshot","updatedAt")
      VALUES (gen_random_uuid(),'77777777-7777-7777-7777-777777777777',1,1000,100,500,'INR','{}'::jsonb, now())
    `);

    // net must equal gross - commission
    await mustReject(`
      INSERT INTO "payouts" ("id","payoutNumber","expertId","provider","grossAmountMinor","commissionAmountMinor","netAmountMinor","currency","idempotencyKey","updatedAt")
      VALUES (gen_random_uuid(),'PYT-CHK','55555555-5555-5555-5555-555555555555','RAZORPAY',1000,100,999,'INR','chk-key-1', now())
    `);

    // The correct arithmetic must be accepted.
    await db.exec(`
      INSERT INTO "commissions" ("id","commissionRuleId","commissionRuleVersion","grossAmountMinor","commissionAmountMinor","expertPayableMinor","currency","calculationSnapshot","updatedAt")
      VALUES (gen_random_uuid(),'77777777-7777-7777-7777-777777777777',1,1000,100,900,'INR','{}'::jsonb, now())
    `);
  });

  it('rejects a negative or zero ledger amount — direction is entryType, not sign', async () => {
    await db.exec(`
      INSERT INTO "transactions" ("id","transactionNumber","type","amountMinor","currency")
      VALUES ('88888888-8888-8888-8888-888888888888','TXN-CHK','ADJUSTMENT',1000,'INR')
    `);
    await mustReject(`
      INSERT INTO "transaction_ledger" ("id","transactionId","account","entryType","amountMinor","currency")
      VALUES (gen_random_uuid(),'88888888-8888-8888-8888-888888888888','PLATFORM_CASH','DEBIT',-1,'INR')
    `);
    await mustReject(`
      INSERT INTO "transaction_ledger" ("id","transactionId","account","entryType","amountMinor","currency")
      VALUES (gen_random_uuid(),'88888888-8888-8888-8888-888888888888','PLATFORM_CASH','DEBIT',0,'INR')
    `);
  });

  it('rejects an invalid ISO-4217 currency code', async () => {
    await mustReject(`
      INSERT INTO "transactions" ("id","transactionNumber","type","amountMinor","currency")
      VALUES (gen_random_uuid(),'TXN-CHK-BADCUR','ADJUSTMENT',1000,'xx1')
    `);
  });

  it('makes a HIGH-risk AI action impossible to auto-approve', async () => {
    await db.exec(`
      INSERT INTO "ai_agents" ("id","key","name","updatedAt")
      VALUES ('99999999-9999-9999-9999-999999999999','MATCHING','M', now());
      INSERT INTO "ai_runs" ("id","agentId","model","provider","inputPayload")
      VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','99999999-9999-9999-9999-999999999999','claude-opus-5','anthropic','{}'::jsonb);
    `);

    await mustReject(`
      INSERT INTO "ai_actions" ("id","aiRunId","toolName","riskTier","requestedPayload","status")
      VALUES (gen_random_uuid(),'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','createContractDraft','HIGH','{}'::jsonb,'AUTO_APPROVED')
    `);

    // Executing a HIGH-risk action without a named approver is also rejected.
    await mustReject(`
      INSERT INTO "ai_actions" ("id","aiRunId","toolName","riskTier","requestedPayload","status")
      VALUES (gen_random_uuid(),'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','createContractDraft','CRITICAL','{}'::jsonb,'EXECUTED')
    `);

    // A LOW-risk action may auto-approve.
    await db.exec(`
      INSERT INTO "ai_actions" ("id","aiRunId","toolName","riskTier","requestedPayload","status")
      VALUES (gen_random_uuid(),'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','searchExperts','LOW','{}'::jsonb,'AUTO_APPROVED')
    `);
  });

  it('rejects an out-of-range score, rating or availability window', async () => {
    await mustReject(`
      INSERT INTO "expert_performance" ("id","expertId","onTimeDeliveryRate","updatedAt")
      VALUES (gen_random_uuid(),'55555555-5555-5555-5555-555555555555',10001, now())
    `);
    await mustReject(`
      INSERT INTO "availability" ("id","expertId","dayOfWeek","startMinute","endMinute","timezone","updatedAt")
      VALUES (gen_random_uuid(),'55555555-5555-5555-5555-555555555555',1,600,600,'UTC', now())
    `);
    await mustReject(`
      INSERT INTO "availability" ("id","expertId","dayOfWeek","startMinute","endMinute","timezone","updatedAt")
      VALUES (gen_random_uuid(),'55555555-5555-5555-5555-555555555555',9,540,1080,'UTC', now())
    `);
  });

  it('rejects self-parenting in hierarchies', async () => {
    await mustReject(
      `UPDATE "categories" SET "parentId" = "id" WHERE "id" = '11111111-1111-1111-1111-111111111111'`,
    );
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
