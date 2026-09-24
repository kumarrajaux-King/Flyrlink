/**
 * Phase 8 structural boundaries — properties of the admin control plane's source
 * that must hold for every current AND future file, so a regression fails here
 * even if no behavioural test happens to exercise it:
 *
 *   - no hard deletes (destructive-operation bypass);
 *   - no audit record is ever edited or deleted, and none is written except
 *     through `writeAudit` (audit bypass);
 *   - no ledger, transaction, payment, refund, order or commission write
 *     (arbitrary balance manipulation);
 *   - no direct status write to a project, contract or milestone (lifecycle
 *     bypass);
 *   - raw SQL only to lock rows;
 *   - every admin route authenticates through the shared handlers and never
 *     touches the database itself.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

function sourceFiles(directory: string, suffix: string): { path: string; source: string }[] {
  return (readdirSync(join(ROOT, directory), { recursive: true }) as string[])
    .filter((file) => file.endsWith(suffix))
    .map((file) => {
      const path = `${directory}/${file.replace(/\\/g, '/')}`;
      return { path, source: readFileSync(join(ROOT, path), 'utf8') };
    });
}

const services = sourceFiles('services/admin', '.ts');
const routes = sourceFiles('app/api/admin', 'route.ts');

function offenders(files: { path: string; source: string }[], pattern: RegExp): string[] {
  return files.filter((file) => pattern.test(file.source)).map((file) => file.path);
}

describe('admin services', () => {
  it('exist', () => {
    expect(services.length).toBeGreaterThanOrEqual(15);
  });

  it('never hard-delete anything', () => {
    expect(offenders(services, /\.(delete|deleteMany)\(/)).toEqual([]);
  });

  it('never edit, delete or directly create an audit record', () => {
    expect(offenders(services, /auditLog\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/)).toEqual([]);
  });

  it('never write money: no ledger, transaction, payment, refund, order or commission writes', () => {
    expect(
      offenders(
        services,
        /\b(ledgerEntry|transaction|payment|refund|order|commission|commissionRule|payoutItem)\.(create|createMany|update|updateMany|upsert)\(/,
      ),
    ).toEqual([]);
  });

  it('never change a project, contract or milestone except through the lifecycle', () => {
    expect(offenders(services, /\b(project|contract|milestone|contractVersion)\.(create|createMany|update|updateMany|upsert)\(/)).toEqual(
      [],
    );
  });

  it('use raw SQL only to lock rows', () => {
    for (const file of services) {
      for (const match of file.source.matchAll(/\$(queryRawUnsafe|executeRawUnsafe|executeRaw|queryRaw)\b[\s\S]{0,200}/g)) {
        expect(match[0], file.path).toMatch(/FOR UPDATE/);
      }
    }
  });
});

describe('admin routes', () => {
  it('exist', () => {
    expect(routes.length).toBeGreaterThanOrEqual(45);
  });

  it('authenticate through the shared handlers or the session helper', () => {
    expect(
      routes.filter((file) => !/handleAdminRead|handleAdminMutation|requireSession/.test(file.source)).map((file) => file.path),
    ).toEqual([]);
  });

  it('never import the database client — authorization lives in the services', () => {
    expect(offenders(routes, /lib\/db\/client/)).toEqual([]);
  });

  it('offer no PUT, and DELETE only for sign-out, lockout and role revocation — none of them destructive', () => {
    expect(offenders(routes, /export (async )?function PUT\b/)).toEqual([]);
    expect(offenders(routes, /export (async )?function DELETE\b/).sort()).toEqual([
      'app/api/admin/users/[userId]/lockout/route.ts',
      'app/api/admin/users/[userId]/roles/route.ts',
      'app/api/admin/users/[userId]/sessions/route.ts',
    ]);
  });
});
