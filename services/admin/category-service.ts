/**
 * Category management (Phase 8) on the one approved Category tree (D-02).
 *
 * Categories are data, never hard-coded. Managing them is platform
 * configuration: a category can scope a commission rule, so moving or
 * deactivating one can change which rule applies to future work. Reads
 * therefore need `config:read:any`, and changes need `config:update:any`, which
 * is SUPER_ADMIN-gated and MFA-gated.
 *
 * Nothing is deleted. Projects, services, skills and commission rules keep
 * referencing a category after it is retired, so a category is deactivated
 * instead, and every change is audited with its before and after state.
 */

import { AUDIT_ACTIONS, type RequestContext, writeAudit } from '../../lib/audit/audit';
import { assertCapability, normalizeReason } from '../../lib/authz/admin-policy';
import type { Actor } from '../../lib/authz/authorize';
import { type Db, type PrismaTransaction, prisma } from '../../lib/db/client';
import { executeAdminMutation } from './admin-mutation';
import { type AdminOutcome, AdminRejection, isUuid, lockRow, precondition, severityFor } from './outcome';

export interface AdminCategory {
  readonly categoryId: string;
  readonly name: string;
  readonly slug: string;
  readonly description: string | null;
  readonly parentId: string | null;
  readonly depth: number;
  readonly isActive: boolean;
  readonly orderIndex: number;
  readonly counts: {
    readonly children: number;
    readonly skills: number;
    readonly services: number;
    readonly projects: number;
    readonly commissionRules: number;
  };
  readonly createdAt: string;
  readonly updatedAt: string;
}

const TREE_LIMIT = 5000;

/** The whole tree, flattened depth-first, so a client can render it without re-sorting. */
export async function getCategoryTree(
  params: { readonly actor: Actor; readonly includeInactive?: boolean | undefined },
  db: Db = prisma,
): Promise<{ readonly categories: readonly AdminCategory[] }> {
  assertCapability(params.actor, 'CATEGORIES_READ');

  const rows = await db.category.findMany({
    where: params.includeInactive ? {} : { isActive: true },
    orderBy: [{ orderIndex: 'asc' }, { name: 'asc' }],
    take: TREE_LIMIT,
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      parentId: true,
      isActive: true,
      orderIndex: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { children: true, skills: true, services: true, projects: true, commissionRules: true } },
    },
  });

  const present = new Set(rows.map((row) => row.id));
  const children = new Map<string | null, typeof rows>();
  for (const row of rows) {
    // A child of a filtered-out (inactive) parent is shown at the top level rather than lost.
    const parent = row.parentId !== null && present.has(row.parentId) ? row.parentId : null;
    children.set(parent, [...(children.get(parent) ?? []), row]);
  }

  const ordered: AdminCategory[] = [];
  const visit = (parentId: string | null, depth: number): void => {
    for (const row of children.get(parentId) ?? []) {
      ordered.push({
        categoryId: row.id,
        name: row.name,
        slug: row.slug,
        description: row.description,
        parentId: row.parentId,
        depth,
        isActive: row.isActive,
        orderIndex: row.orderIndex,
        counts: row._count,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      });
      visit(row.id, depth + 1);
    }
  };
  visit(null, 0);

  return { categories: ordered };
}

interface CategoryRow {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly description: string | null;
  readonly parentId: string | null;
  readonly isActive: boolean;
  readonly orderIndex: number;
}

const CATEGORY_SELECT = {
  id: true,
  name: true,
  slug: true,
  description: true,
  parentId: true,
  isActive: true,
  orderIndex: true,
} as const;

async function lockCategory(tx: PrismaTransaction, id: string): Promise<CategoryRow | null> {
  if (!(await lockRow(tx, 'categories', id))) return null;
  return tx.category.findUnique({ where: { id }, select: CATEGORY_SELECT });
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002';
}

export interface CreateCategoryRequest {
  readonly actor: Actor;
  readonly name: string;
  readonly slug: string;
  readonly description?: string | undefined;
  readonly parentId?: string | null | undefined;
  readonly orderIndex?: number | undefined;
  readonly reason?: string | undefined;
  readonly context?: RequestContext | undefined;
}

export async function createCategory(request: CreateCategoryRequest, db: Db = prisma): Promise<AdminOutcome> {
  return executeAdminMutation(
    {
      entityType: 'Category',
      entityId: null,
      event: 'CREATE',
      actor: request.actor,
      capability: 'CATEGORIES_MANAGE',
      risk: 'MEDIUM',
      justification: { reason: request.reason },
      context: request.context,
      async run(tx, base) {
        const parentId = request.parentId ?? null;
        if (parentId !== null) {
          const parent = isUuid(parentId) ? await lockCategory(tx, parentId) : null;
          if (!parent) throw precondition('The parent category does not exist.');
          if (!parent.isActive) throw precondition('A category cannot be created under an inactive parent.');
        }

        const taken = await tx.category.findUnique({ where: { slug: request.slug }, select: { id: true } });
        if (taken) throw precondition(`The slug "${request.slug}" is already in use.`);

        let created: CategoryRow;
        try {
          created = await tx.category.create({
            data: {
              name: request.name.trim(),
              slug: request.slug,
              description: request.description?.trim() || null,
              parentId,
              orderIndex: request.orderIndex ?? 0,
            },
            select: CATEGORY_SELECT,
          });
        } catch (error) {
          if (isUniqueViolation(error)) throw precondition(`The slug "${request.slug}" is already in use.`);
          throw error;
        }

        await writeAudit(tx, {
          action: AUDIT_ACTIONS.ADMIN_CATEGORY_CREATED,
          entityType: 'Category',
          entityId: created.id,
          actorUserId: request.actor.userId,
          severity: severityFor('MEDIUM'),
          afterState: { ...created, reason: normalizeReason(request.reason) },
          ...request.context,
        });

        return {
          ...base,
          entityId: created.id,
          result: 'APPLIED',
          from: null,
          to: 'ACTIVE',
          cascades: [],
          detail: { categoryId: created.id, slug: created.slug },
        };
      },
    },
    db,
  );
}

export interface UpdateCategoryRequest {
  readonly actor: Actor;
  readonly categoryId: string;
  readonly name?: string | undefined;
  readonly description?: string | null | undefined;
  readonly parentId?: string | null | undefined;
  readonly orderIndex?: number | undefined;
  readonly reason?: string | undefined;
  readonly context?: RequestContext | undefined;
}

/** Rename, re-describe, reorder or move a category. The slug is its stable identity and does not change. */
export async function updateCategory(request: UpdateCategoryRequest, db: Db = prisma): Promise<AdminOutcome> {
  return executeAdminMutation(
    {
      entityType: 'Category',
      entityId: request.categoryId,
      event: 'UPDATE',
      actor: request.actor,
      capability: 'CATEGORIES_MANAGE',
      risk: 'MEDIUM',
      justification: { reason: request.reason },
      context: request.context,
      async run(tx, base) {
        const current = await lockCategory(tx, request.categoryId);
        if (!current) throw new AdminRejection('NOT_FOUND', 'No category with that id.');

        const changes: { name?: string; description?: string | null; parentId?: string | null; orderIndex?: number } = {};
        if (request.name !== undefined && request.name.trim() !== current.name) changes.name = request.name.trim();
        if (request.description !== undefined) {
          const description = request.description?.trim() || null;
          if (description !== current.description) changes.description = description;
        }
        if (request.orderIndex !== undefined && request.orderIndex !== current.orderIndex) {
          changes.orderIndex = request.orderIndex;
        }
        if (request.parentId !== undefined && request.parentId !== current.parentId) {
          await assertValidMove(tx, current, request.parentId);
          changes.parentId = request.parentId;
        }

        if (Object.keys(changes).length === 0) {
          return { ...base, result: 'NO_OP', status: current.isActive ? 'ACTIVE' : 'INACTIVE' };
        }

        await tx.category.update({ where: { id: current.id }, data: changes });

        const before: Record<string, unknown> = {};
        for (const key of Object.keys(changes) as (keyof typeof changes)[]) before[key] = current[key];

        await writeAudit(tx, {
          action: AUDIT_ACTIONS.ADMIN_CATEGORY_UPDATED,
          entityType: 'Category',
          entityId: current.id,
          actorUserId: request.actor.userId,
          severity: severityFor('MEDIUM'),
          beforeState: before,
          afterState: { ...changes, reason: normalizeReason(request.reason) },
          ...request.context,
        });

        return { ...base, result: 'APPLIED', from: null, to: null, cascades: [], detail: { changed: Object.keys(changes) } };
      },
    },
    db,
  );
}

/** A move may not create a cycle, and an active category may not sit under an inactive one. */
async function assertValidMove(tx: PrismaTransaction, category: CategoryRow, parentId: string | null): Promise<void> {
  if (parentId === null) return;
  if (parentId === category.id) throw precondition('A category cannot be its own parent.');

  const parent = isUuid(parentId) ? await lockCategory(tx, parentId) : null;
  if (!parent) throw precondition('The new parent category does not exist.');
  if (category.isActive && !parent.isActive) {
    throw precondition('An active category cannot be moved under an inactive parent.');
  }

  // Walk up from the new parent: meeting the category itself means the move would close a loop.
  let ancestorId: string | null = parent.parentId;
  for (let depth = 0; ancestorId !== null; depth += 1) {
    if (ancestorId === category.id) throw precondition('That move would make a category its own ancestor.');
    if (depth > 1000) throw precondition('The category tree is too deep to verify this move.');
    const ancestor: { parentId: string | null } | null = await tx.category.findUnique({
      where: { id: ancestorId },
      select: { parentId: true },
    });
    ancestorId = ancestor?.parentId ?? null;
  }
}

export interface CategoryStatusRequest {
  readonly actor: Actor;
  readonly categoryId: string;
  readonly isActive: boolean;
  readonly reason?: string | undefined;
  readonly confirm?: boolean | undefined;
  readonly context?: RequestContext | undefined;
}

/**
 * Activate or deactivate a category. Deactivation withdraws it from the
 * marketplace and may change commission scoping, so it is HIGH risk and must be
 * confirmed; activation is MEDIUM.
 */
export async function setCategoryActive(request: CategoryStatusRequest, db: Db = prisma): Promise<AdminOutcome> {
  const risk = request.isActive ? 'MEDIUM' : 'HIGH';

  return executeAdminMutation(
    {
      entityType: 'Category',
      entityId: request.categoryId,
      event: request.isActive ? 'ACTIVATE' : 'DEACTIVATE',
      actor: request.actor,
      capability: 'CATEGORIES_MANAGE',
      risk,
      justification: { reason: request.reason, confirm: request.confirm },
      context: request.context,
      async run(tx, base) {
        const current = await lockCategory(tx, request.categoryId);
        if (!current) throw new AdminRejection('NOT_FOUND', 'No category with that id.');

        const status = (active: boolean): string => (active ? 'ACTIVE' : 'INACTIVE');
        if (current.isActive === request.isActive) {
          return { ...base, result: 'NO_OP', status: status(current.isActive) };
        }

        if (request.isActive) {
          if (current.parentId !== null) {
            const parent = await tx.category.findUnique({ where: { id: current.parentId }, select: { isActive: true } });
            if (!parent?.isActive) throw precondition('Activate its parent category first.');
          }
        } else {
          const activeChildren = await tx.category.count({ where: { parentId: current.id, isActive: true } });
          if (activeChildren > 0) throw precondition('Deactivate its active subcategories first.');
        }

        await tx.category.update({ where: { id: current.id }, data: { isActive: request.isActive } });

        await writeAudit(tx, {
          action: AUDIT_ACTIONS.ADMIN_CATEGORY_STATUS_CHANGED,
          entityType: 'Category',
          entityId: current.id,
          actorUserId: request.actor.userId,
          severity: severityFor(risk),
          beforeState: { isActive: current.isActive },
          afterState: { isActive: request.isActive, reason: normalizeReason(request.reason) },
          ...request.context,
        });

        return {
          ...base,
          result: 'APPLIED',
          from: status(current.isActive),
          to: status(request.isActive),
          cascades: [],
        };
      },
    },
    db,
  );
}
