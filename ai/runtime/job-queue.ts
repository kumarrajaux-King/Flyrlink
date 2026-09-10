/**
 * Background job abstraction for agent work.
 *
 * No new job table was introduced. `AiRun` already has a `QUEUED` status and is
 * durable, indexed and auditable, so it *is* the queue — which avoids a second
 * source of truth for "what work is outstanding" and keeps every queued item
 * visible in the same admin views as completed runs.
 *
 * The interface below is what the rest of the system depends on. Swapping the
 * driver for Redis/BullMQ at the scale tier (STEP 02 §15) means reimplementing
 * `AgentJobQueue`, not touching any caller.
 */

import type { Actor } from '../../lib/authz/authorize';
import { type Db, prisma } from '../../lib/db/client';
import type { AgentKey } from '../agents/definitions';
import { getAgentDefinition } from '../agents/definitions';
import { resolveAgentRecords } from './agent-sync';
import { runAgent } from './orchestrator';

export interface EnqueuedJob {
  readonly runId: string;
  readonly agentKey: AgentKey;
}

export interface AgentJobQueue {
  enqueue(params: {
    agentKey: AgentKey;
    input: unknown;
    actorUserId: string;
    projectId?: string | undefined;
    trigger?: 'SYSTEM_EVENT' | 'SCHEDULED' | 'RETRY';
  }): Promise<EnqueuedJob>;

  /** Claim and run up to `limit` queued jobs. Returns how many were processed. */
  drain(params: { limit: number; resolveActor: (userId: string) => Promise<Actor | null> }): Promise<number>;
}

/**
 * `AiRun`-backed queue.
 *
 * A queued run is created up front so the work is durable the moment it is
 * requested — if the process dies before the worker picks it up, the record is
 * still there and still visible.
 */
export class AiRunJobQueue implements AgentJobQueue {
  constructor(private readonly db: Db = prisma) {}

  async enqueue(params: {
    agentKey: AgentKey;
    input: unknown;
    actorUserId: string;
    projectId?: string | undefined;
    trigger?: 'SYSTEM_EVENT' | 'SCHEDULED' | 'RETRY';
  }): Promise<EnqueuedJob> {
    const definition = getAgentDefinition(params.agentKey);
    const records = await resolveAgentRecords(this.db, definition);

    const run = await this.db.aiRun.create({
      data: {
        agentId: records.agentId,
        agentVersionId: records.agentVersionId,
        model: definition.model,
        provider: definition.provider,
        projectId: params.projectId ?? null,
        trigger: params.trigger ?? 'SYSTEM_EVENT',
        triggeredByUserId: params.actorUserId,
        status: 'QUEUED',
        // Stored unredacted-shaped but redaction happens in the orchestrator on
        // execution; the queued payload is the request, not the run record.
        inputPayload: JSON.parse(JSON.stringify(params.input ?? null)) as never,
      },
      select: { id: true },
    });

    return { runId: run.id, agentKey: params.agentKey };
  }

  async drain(params: {
    limit: number;
    resolveActor: (userId: string) => Promise<Actor | null>;
  }): Promise<number> {
    const queued = await this.db.aiRun.findMany({
      where: { status: 'QUEUED' },
      orderBy: { createdAt: 'asc' },
      take: params.limit,
      select: {
        id: true,
        inputPayload: true,
        projectId: true,
        triggeredByUserId: true,
        trigger: true,
        agent: { select: { key: true } },
      },
    });

    let processed = 0;

    for (const job of queued) {
      // Claim it first: the conditional update means two workers cannot both
      // pick up the same run.
      const claimed = await this.db.aiRun.updateMany({
        where: { id: job.id, status: 'QUEUED' },
        data: { status: 'RUNNING', startedAt: new Date() },
      });
      if (claimed.count === 0) continue;

      const actor = job.triggeredByUserId
        ? await params.resolveActor(job.triggeredByUserId)
        : null;

      if (!actor) {
        // No identity means no permissions to check against, so the work cannot
        // safely proceed.
        await this.db.aiRun.update({
          where: { id: job.id },
          data: {
            status: 'CANCELLED',
            errorCode: 'NO_ACTOR',
            errorMessage: 'The triggering user could not be resolved.',
            completedAt: new Date(),
          },
        });
        continue;
      }

      // The orchestrator opens its own run record; this queued row is the
      // durable request. Mark it superseded once the real run completes.
      const result = await runAgent({
        agentKey: job.agent.key as AgentKey,
        input: job.inputPayload,
        actor,
        projectId: job.projectId ?? undefined,
        trigger: 'SCHEDULED',
        db: this.db,
      });

      await this.db.aiRun.update({
        where: { id: job.id },
        data: {
          status: result.status === 'SUCCEEDED' ? 'SUCCEEDED' : 'FAILED',
          completedAt: new Date(),
          errorCode: result.errorCode ?? null,
          errorMessage: result.errorMessage ?? `Executed as run ${result.runId}`,
        },
      });

      processed += 1;
    }

    return processed;
  }
}
