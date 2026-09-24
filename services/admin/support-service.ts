/**
 * Support lookup (Phase 8).
 *
 * The approved schema has no support-ticket model, so the support desk's
 * backend is search: find the account, project, contract or dispute a request is
 * about, by id, email, name or reference number. Access needs
 * `ticket:read:any`, and each kind of result is included only for a caller who
 * may read that kind of record — the others come back as null, not empty, so a
 * client can tell "nothing found" from "not yours to see".
 *
 * Read-only. Acting on what is found goes through the governed services.
 */

import { assertCapability, hasCapability } from '../../lib/authz/admin-policy';
import type { Actor } from '../../lib/authz/authorize';
import { type Db, prisma } from '../../lib/db/client';
import { isUuid } from './outcome';

const INSENSITIVE = 'insensitive' as const;
const RESULT_LIMIT = 10;

export interface SupportLookupResult {
  readonly query: string;
  readonly users:
    | readonly { readonly userId: string; readonly email: string; readonly fullName: string; readonly status: string }[]
    | null;
  readonly projects:
    | readonly { readonly projectId: string; readonly projectNumber: string; readonly title: string; readonly status: string }[]
    | null;
  readonly contracts:
    | readonly { readonly contractId: string; readonly contractNumber: string; readonly status: string; readonly projectId: string }[]
    | null;
  readonly disputes:
    | readonly { readonly disputeId: string; readonly status: string; readonly reason: string; readonly projectId: string }[]
    | null;
}

export async function supportLookup(
  params: { readonly actor: Actor; readonly q: string },
  db: Db = prisma,
): Promise<SupportLookupResult> {
  assertCapability(params.actor, 'SUPPORT_LOOKUP');

  const q = params.q.trim();
  const byId = isUuid(q);

  const [users, projects, contracts, disputes] = await Promise.all([
    hasCapability(params.actor, 'USERS_READ')
      ? db.user.findMany({
          where: {
            deletedAt: null,
            ...(byId
              ? { id: q }
              : { OR: [{ email: { contains: q, mode: INSENSITIVE } }, { fullName: { contains: q, mode: INSENSITIVE } }] }),
          },
          orderBy: { id: 'desc' },
          take: RESULT_LIMIT,
          select: { id: true, email: true, fullName: true, status: true },
        })
      : null,
    hasCapability(params.actor, 'PROJECTS_READ')
      ? db.project.findMany({
          where: {
            deletedAt: null,
            ...(byId
              ? { id: q }
              : { OR: [{ projectNumber: { equals: q, mode: INSENSITIVE } }, { title: { contains: q, mode: INSENSITIVE } }] }),
          },
          orderBy: { id: 'desc' },
          take: RESULT_LIMIT,
          select: { id: true, projectNumber: true, title: true, status: true },
        })
      : null,
    hasCapability(params.actor, 'CONTRACTS_READ')
      ? db.contract.findMany({
          where: byId ? { id: q } : { contractNumber: { equals: q, mode: INSENSITIVE } },
          orderBy: { id: 'desc' },
          take: RESULT_LIMIT,
          select: { id: true, contractNumber: true, status: true, projectId: true },
        })
      : null,
    hasCapability(params.actor, 'DISPUTES_READ')
      ? byId
        ? db.dispute.findMany({
            where: { OR: [{ id: q }, { projectId: q }] },
            orderBy: { id: 'desc' },
            take: RESULT_LIMIT,
            select: { id: true, status: true, reason: true, projectId: true },
          })
        : Promise.resolve([])
      : null,
  ]);

  return {
    query: q,
    users: users?.map((user) => ({ userId: user.id, email: user.email, fullName: user.fullName, status: user.status })) ?? null,
    projects:
      projects?.map((project) => ({
        projectId: project.id,
        projectNumber: project.projectNumber,
        title: project.title,
        status: project.status,
      })) ?? null,
    contracts:
      contracts?.map((contract) => ({
        contractId: contract.id,
        contractNumber: contract.contractNumber,
        status: contract.status,
        projectId: contract.projectId,
      })) ?? null,
    disputes:
      disputes?.map((dispute) => ({
        disputeId: dispute.id,
        status: dispute.status,
        reason: dispute.reason,
        projectId: dispute.projectId,
      })) ?? null,
  };
}
