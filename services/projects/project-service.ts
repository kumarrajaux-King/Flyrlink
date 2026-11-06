/**
 * Projects: creating a brief, listing your own, and reading one.
 *
 * This is the entry point the intake flow needs and Phase 3 left unbuilt: the
 * walkthrough had to write project rows with Prisma because nothing else could.
 *
 * WHAT THIS SERVICE DOES NOT DO
 *   It never changes `status`. A project is created as `DRAFT` and moves only
 *   through the Phase 6 lifecycle engine, which owns every status write for all
 *   four machines. `submitProject` here is a thin, honest wrapper that calls
 *   that engine rather than a second write path — there is exactly one.
 *
 * OWNERSHIP
 *   Every read goes through `authorize` with the project's own customer, so
 *   there is no code path that loads a project by id alone (STEP 02 §8). A
 *   caller holding `project:read:any` (support, admin) passes without being a
 *   party; everyone else must be the customer on the record.
 */

import { AUDIT_ACTIONS, type RequestContext, writeAudit } from '../../lib/audit/audit';
import { type Actor, assertAuthorized } from '../../lib/authz/authorize';
import { type Db, prisma } from '../../lib/db/client';
import { type Page, type PageRequest, iso, minor, newestFirst, pageSize, toPage } from '../../lib/pagination';
import type { CreateProjectInput } from '../../lib/validation/projects';

export class ProjectRejection extends Error {
  readonly code: 'NOT_FOUND' | 'NO_CUSTOMER_PROFILE' | 'NOT_EDITABLE';

  constructor(code: ProjectRejection['code'], message: string) {
    super(message);
    this.name = 'ProjectRejection';
    this.code = code;
  }
}

export interface ProjectView {
  readonly id: string;
  readonly projectNumber: string;
  readonly title: string;
  readonly description: string;
  readonly status: string;
  readonly source: string;
  readonly engagementType: string;
  readonly currency: string;
  readonly budgetMinMinor: string | null;
  readonly budgetMaxMinor: string | null;
  readonly estimatedEffortHours: number | null;
  readonly estimatedDurationDays: number | null;
  readonly estimatedBudgetMinMinor: string | null;
  readonly estimatedBudgetMaxMinor: string | null;
  readonly deadline: string | null;
  readonly submittedAt: string | null;
  readonly createdAt: string;
  readonly requirements: readonly RequirementView[];
}

export interface RequirementView {
  readonly id: string;
  readonly type: string;
  readonly content: string;
  readonly priority: number;
  /** AI_AGENT or CUSTOMER — the page labels an AI-authored line as one. */
  readonly source: string;
  readonly isApproved: boolean;
}

const PROJECT_SELECT = {
  id: true,
  projectNumber: true,
  title: true,
  description: true,
  status: true,
  source: true,
  engagementType: true,
  currency: true,
  budgetMinMinor: true,
  budgetMaxMinor: true,
  estimatedEffortHours: true,
  estimatedDurationDays: true,
  estimatedBudgetMinMinor: true,
  estimatedBudgetMaxMinor: true,
  deadline: true,
  submittedAt: true,
  createdAt: true,
  customer: { select: { userId: true } },
  requirements: {
    orderBy: [{ priority: 'desc' as const }, { createdAt: 'asc' as const }],
    select: { id: true, type: true, content: true, priority: true, source: true, isApproved: true },
  },
  // Not `as const`: Prisma's orderBy input rejects a readonly tuple.
};

type ProjectRow = {
  id: string;
  projectNumber: string;
  title: string;
  description: string;
  status: string;
  source: string;
  engagementType: string;
  currency: string;
  budgetMinMinor: bigint | null;
  budgetMaxMinor: bigint | null;
  estimatedEffortHours: number | null;
  estimatedDurationDays: number | null;
  estimatedBudgetMinMinor: bigint | null;
  estimatedBudgetMaxMinor: bigint | null;
  deadline: Date | null;
  submittedAt: Date | null;
  createdAt: Date;
  customer: { userId: string };
  requirements: {
    id: string;
    type: string;
    content: string;
    priority: number;
    source: string;
    isApproved: boolean;
  }[];
};

function view(row: ProjectRow): ProjectView {
  return {
    id: row.id,
    projectNumber: row.projectNumber,
    title: row.title,
    description: row.description,
    status: row.status,
    source: row.source,
    engagementType: row.engagementType,
    currency: row.currency,
    budgetMinMinor: minor(row.budgetMinMinor),
    budgetMaxMinor: minor(row.budgetMaxMinor),
    estimatedEffortHours: row.estimatedEffortHours,
    estimatedDurationDays: row.estimatedDurationDays,
    estimatedBudgetMinMinor: minor(row.estimatedBudgetMinMinor),
    estimatedBudgetMaxMinor: minor(row.estimatedBudgetMaxMinor),
    deadline: iso(row.deadline),
    submittedAt: iso(row.submittedAt),
    createdAt: row.createdAt.toISOString(),
    requirements: row.requirements.map((requirement) => ({
      id: requirement.id,
      type: requirement.type,
      content: requirement.content,
      priority: requirement.priority,
      source: requirement.source,
      isApproved: requirement.isApproved,
    })),
  };
}

/**
 * A readable, collision-free project number.
 *
 * The date makes it legible to a human reading a support ticket; the random
 * suffix is what actually makes it unique, so two projects created in the same
 * millisecond do not race for the same number.
 */
function projectNumber(now: Date): string {
  const stamp = now.toISOString().slice(0, 10).replace(/-/g, '');
  const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `P-${stamp}-${suffix}`;
}

/** The customer profile for this actor, or a refusal naming what is missing. */
async function customerProfileFor(db: Db, actor: Actor): Promise<{ id: string }> {
  const profile = await db.customerProfile.findUnique({
    where: { userId: actor.userId },
    select: { id: true },
  });
  if (!profile) {
    throw new ProjectRejection(
      'NO_CUSTOMER_PROFILE',
      'This account has no customer profile, so it cannot post a project.',
    );
  }
  return profile;
}

/**
 * Create a brief as `DRAFT`.
 *
 * `source` is always `POSTED_PROJECT` here: direct hire and predefined service
 * are different entry flows with their own preconditions (an invited expert, a
 * service to buy), and letting a client choose the source on this endpoint
 * would let it create a record the rest of the system expects to be linked.
 */
export async function createProject(
  db: Db,
  actor: Actor,
  input: CreateProjectInput,
  context: RequestContext = {},
): Promise<ProjectView> {
  const profile = await customerProfileFor(db, actor);
  assertAuthorized(actor, 'project:create:own', { ownerUserId: actor.userId });

  const now = new Date();
  const created = await db.project.create({
    data: {
      projectNumber: projectNumber(now),
      customerId: profile.id,
      source: 'POSTED_PROJECT',
      status: 'DRAFT',
      title: input.title,
      description: input.description,
      engagementType: input.engagementType,
      currency: input.currency,
      budgetMinMinor: input.budgetMinMinor ?? null,
      budgetMaxMinor: input.budgetMaxMinor ?? null,
      deadline: input.deadline ? new Date(input.deadline) : null,
    },
    select: PROJECT_SELECT,
  });

  await writeAudit(db, {
    action: AUDIT_ACTIONS.PROJECT_CREATED,
    entityType: 'Project',
    entityId: created.id,
    actorUserId: actor.userId,
    afterState: { projectNumber: created.projectNumber, source: 'POSTED_PROJECT', status: 'DRAFT' },
    ...context,
  });

  return view(created);
}

/** Load a project the actor may read, or refuse. */
export async function getProject(db: Db, actor: Actor, projectId: string): Promise<ProjectView> {
  const row = await db.project.findFirst({
    where: { id: projectId, deletedAt: null },
    select: PROJECT_SELECT,
  });
  if (!row) throw new ProjectRejection('NOT_FOUND', 'No project with that id.');

  // Throws AuthorizationError, which the response mapper turns into 401/403.
  assertAuthorized(actor, 'project:read:own', { customerUserId: row.customer.userId });
  return view(row);
}

export interface ProjectQuery extends PageRequest {
  readonly status?: string | undefined;
}

/** The caller's own briefs, newest first. */
export async function listProjects(
  db: Db,
  actor: Actor,
  query: ProjectQuery = {},
): Promise<Page<ProjectView>> {
  // Authorize before reading anything. The list is the caller's own, so the
  // resource is the caller — but the check still has to run: it is what applies
  // account standing, so a suspended or unverified account is refused here
  // rather than being served its own data because the rows happen to be theirs.
  assertAuthorized(actor, 'project:read:own', { ownerUserId: actor.userId });

  const profile = await db.customerProfile.findUnique({
    where: { userId: actor.userId },
    select: { id: true },
  });
  // No profile means no projects, which is an empty list rather than an error:
  // an expert opening the client inbox should see nothing, not a failure.
  if (!profile) return { items: [], nextCursor: null };

  const size = pageSize(query.limit);
  const rows = await db.project.findMany({
    where: {
      customerId: profile.id,
      deletedAt: null,
      ...(query.status ? { status: query.status as never } : {}),
      ...newestFirst(query.cursor),
    },
    orderBy: { id: 'desc' },
    take: size + 1,
    select: PROJECT_SELECT,
  });

  return toPage(rows, size, view);
}

/**
 * Edit a brief before it is submitted.
 *
 * Only while `DRAFT`. Once the project has been submitted, the description is
 * what the analysis and any recommendation were produced against, and quietly
 * rewriting it would leave both describing something nobody agreed to.
 */
export async function updateDraft(
  db: Db,
  actor: Actor,
  projectId: string,
  patch: {
    title?: string | undefined;
    description?: string | undefined;
    budgetMinMinor?: bigint | undefined;
    budgetMaxMinor?: bigint | undefined;
    deadline?: string | null | undefined;
  },
  context: RequestContext = {},
): Promise<ProjectView> {
  const existing = await db.project.findFirst({
    where: { id: projectId, deletedAt: null },
    select: { id: true, status: true, title: true, customer: { select: { userId: true } } },
  });
  if (!existing) throw new ProjectRejection('NOT_FOUND', 'No project with that id.');

  assertAuthorized(actor, 'project:update:own', { customerUserId: existing.customer.userId });

  if (existing.status !== 'DRAFT') {
    throw new ProjectRejection('NOT_EDITABLE', 'A brief can only be edited while it is a draft.');
  }

  const updated = await db.project.update({
    where: { id: projectId },
    data: {
      ...(patch.title === undefined ? {} : { title: patch.title }),
      ...(patch.description === undefined ? {} : { description: patch.description }),
      ...(patch.budgetMinMinor === undefined ? {} : { budgetMinMinor: patch.budgetMinMinor }),
      ...(patch.budgetMaxMinor === undefined ? {} : { budgetMaxMinor: patch.budgetMaxMinor }),
      ...(patch.deadline === undefined ? {} : { deadline: patch.deadline ? new Date(patch.deadline) : null }),
    },
    select: PROJECT_SELECT,
  });

  await writeAudit(db, {
    action: AUDIT_ACTIONS.PROJECT_DRAFT_UPDATED,
    entityType: 'Project',
    entityId: projectId,
    actorUserId: actor.userId,
    beforeState: { title: existing.title },
    afterState: { title: updated.title, fields: Object.keys(patch) },
    ...context,
  });

  return view(updated);
}

/** Convenience for callers with no transaction of their own. */
export const projects = {
  create: (actor: Actor, input: CreateProjectInput, context?: RequestContext) =>
    createProject(prisma, actor, input, context),
  get: (actor: Actor, id: string) => getProject(prisma, actor, id),
  list: (actor: Actor, query?: ProjectQuery) => listProjects(prisma, actor, query),
};
