/**
 * Keeps the code-side agent definitions and the database registry in step.
 *
 * `AiAgent` / `AiAgentVersion` exist so that every past run can be traced back to
 * the exact agent, version, model and prompt that produced it (master spec §34).
 * That only works if the rows are present before a run starts, so the
 * orchestrator resolves them here — creating them on first use rather than
 * depending on a seed having been run.
 *
 * Versions are immutable: changing a prompt means publishing a new version, not
 * editing an existing row, otherwise historical runs would silently start
 * pointing at a prompt that never produced them.
 */

import type { Db } from '../../lib/db/client';
import { AGENT_DEFINITIONS, type AgentDefinition, type AgentKey } from '../agents/definitions';
import { promptHash } from './prompt-hash';

export interface ResolvedAgentRecords {
  readonly agentId: string;
  readonly agentVersionId: string;
  readonly isEnabled: boolean;
}

/** Resolve (creating if needed) the DB rows for one agent definition. */
export async function resolveAgentRecords(
  db: Db,
  definition: AgentDefinition,
): Promise<ResolvedAgentRecords> {
  const agent = await db.aiAgent.upsert({
    where: { key: definition.key },
    update: { name: definition.name, description: definition.description },
    create: {
      key: definition.key,
      name: definition.name,
      description: definition.description,
      defaultRiskTier: definition.defaultRiskTier,
      isEnabled: true,
    },
    select: { id: true, isEnabled: true },
  });

  const hash = promptHash(definition.systemPrompt);

  const existing = await db.aiAgentVersion.findUnique({
    where: { agentId_version: { agentId: agent.id, version: definition.version } },
    select: { id: true, promptHash: true },
  });

  if (existing) {
    if (existing.promptHash && existing.promptHash !== hash) {
      // Loud rather than silent: a changed prompt under an unchanged version
      // number would make historical runs untraceable.
      throw new Error(
        `Agent "${definition.key}" version ${definition.version} has a different prompt than the ` +
          'recorded version. Publish a new version instead of editing an existing one.',
      );
    }
    return { agentId: agent.id, agentVersionId: existing.id, isEnabled: agent.isEnabled };
  }

  const created = await db.aiAgentVersion.create({
    data: {
      agentId: agent.id,
      version: definition.version,
      model: definition.model,
      provider: definition.provider,
      promptRef: definition.promptRef,
      promptHash: hash,
      outputSchemaRef: `${definition.promptRef}#output`,
      isActive: true,
    },
    select: { id: true },
  });

  return { agentId: agent.id, agentVersionId: created.id, isEnabled: agent.isEnabled };
}

/** Register every known agent. Useful for seeding and for the admin registry view. */
export async function syncAllAgents(db: Db): Promise<number> {
  for (const definition of AGENT_DEFINITIONS) {
    await resolveAgentRecords(db, definition);
  }
  return AGENT_DEFINITIONS.length;
}

/** Enable or disable an agent. Disabled agents are refused by the policy engine. */
export async function setAgentEnabled(db: Db, key: AgentKey, isEnabled: boolean): Promise<void> {
  await db.aiAgent.update({ where: { key }, data: { isEnabled } });
}
