/**
 * The controlled tool layer.
 *
 * Master spec §10: agents must NEVER have unrestricted database access. They
 * reach data only through tools registered here, and every tool must declare:
 *
 *   - authentication  → the acting `Actor`, supplied by the orchestrator
 *   - authorization   → `requiredPermission`, checked by the policy engine
 *   - input validation  → Zod schema, parsed before the handler runs
 *   - output validation → Zod schema, parsed before the result is returned
 *   - risk classification → `riskTier`, which decides the approval path
 *   - idempotency     → declared, and enforced by `AiAction`'s unique key
 *   - audit           → every execution writes an audit record
 *   - error handling  → failures are captured, never thrown into the model loop
 *
 * A tool that does not declare these cannot be registered.
 */

import type { z } from 'zod';

import type { Permission } from '../../lib/authz/roles';
import type { Actor } from '../../lib/authz/authorize';
import type { Db } from '../../lib/db/client';
import type { RequestContext } from '../../lib/audit/audit';
import { assertNotForbidden } from '../policy/forbidden';
import type { AiRiskTier } from '../policy/policy-engine';

/** Everything a tool handler is allowed to know about its caller. */
export interface ToolContext {
  /** The human the agent acts for. Handlers scope every query to this identity. */
  readonly actor: Actor;
  readonly db: Db;
  /** The run this call belongs to, for audit correlation. */
  readonly aiRunId: string;
  readonly requestContext?: RequestContext | undefined;
}

export interface AiToolDefinition<TInput = unknown, TOutput = unknown> {
  readonly name: string;
  /** Shown to the model. Describes intent and limits, never implementation. */
  readonly description: string;
  readonly inputSchema: z.ZodType<TInput>;
  readonly outputSchema: z.ZodType<TOutput>;
  readonly riskTier: AiRiskTier;
  readonly requiredPermission: Permission;
  /**
   * Safe to execute twice with the same input. Non-idempotent tools rely on
   * `AiAction.idempotencyKey` to make a retry a no-op.
   */
  readonly idempotent: boolean;
  /** Audit action name recorded on execution. */
  readonly auditAction: string;
  readonly handler: (input: TInput, context: ToolContext) => Promise<TOutput>;
}

// The registry is heterogeneous by nature, so entries are stored with their
// specific types erased. Type safety is preserved at definition and at execution.
type AnyToolDefinition = AiToolDefinition<never, unknown>;

const registry = new Map<string, AnyToolDefinition>();

export class ToolRegistrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolRegistrationError';
  }
}

/**
 * Register a tool.
 *
 * Rejects any name implying a forbidden capability — so the safety rule is
 * enforced at the moment of definition, not left to a reviewer to notice.
 */
export function registerTool<TInput, TOutput>(
  tool: AiToolDefinition<TInput, TOutput>,
): AiToolDefinition<TInput, TOutput> {
  if (registry.has(tool.name)) {
    throw new ToolRegistrationError(`Tool "${tool.name}" is already registered.`);
  }
  // Throws ForbiddenCapabilityError if the name crosses the line.
  assertNotForbidden(tool.name);

  if (tool.requiredPermission.endsWith(':own')) {
    // `:own` permissions need a resource, which the policy engine cannot supply
    // for a tool call. Per-resource scoping belongs inside the handler.
    throw new ToolRegistrationError(
      `Tool "${tool.name}" declares an :own-scoped permission. Tool permissions must be ` +
        ':any-scoped; enforce per-resource ownership inside the handler.',
    );
  }

  registry.set(tool.name, tool as unknown as AnyToolDefinition);
  return tool;
}

export function getTool(name: string): AnyToolDefinition | undefined {
  return registry.get(name);
}

export function listTools(): readonly AnyToolDefinition[] {
  return [...registry.values()];
}

export function toolNames(): readonly string[] {
  return [...registry.keys()].sort();
}

/** Test helper — clears the registry so a suite can register in isolation. */
export function resetRegistry(): void {
  registry.clear();
}

/** Descriptor the policy engine needs, without exposing the handler. */
export function toolDescriptor(
  name: string,
): { name: string; riskTier: AiRiskTier; requiredPermission: Permission } | undefined {
  const tool = registry.get(name);
  if (!tool) return undefined;
  return {
    name: tool.name,
    riskTier: tool.riskTier,
    requiredPermission: tool.requiredPermission,
  };
}

export class ToolInputError extends Error {
  readonly details: unknown;
  constructor(toolName: string, details: unknown) {
    super(`Input for tool "${toolName}" failed validation.`);
    this.name = 'ToolInputError';
    this.details = details;
  }
}

export class ToolOutputError extends Error {
  readonly details: unknown;
  constructor(toolName: string, details: unknown) {
    super(`Output from tool "${toolName}" failed validation.`);
    this.name = 'ToolOutputError';
    this.details = details;
  }
}

/**
 * Execute a registered tool with validation on both sides.
 *
 * The caller is responsible for having obtained an ALLOW (or an approval) from
 * the policy engine first — `executeTool` does not re-evaluate policy, so that
 * there is exactly one place where that decision is made.
 */
export async function executeTool(
  name: string,
  rawInput: unknown,
  context: ToolContext,
): Promise<unknown> {
  const tool = registry.get(name);
  if (!tool) throw new ToolRegistrationError(`No tool named "${name}" is registered.`);

  const parsedInput = tool.inputSchema.safeParse(rawInput);
  if (!parsedInput.success) {
    throw new ToolInputError(name, parsedInput.error.issues);
  }

  const result = await tool.handler(parsedInput.data as never, context);

  const parsedOutput = tool.outputSchema.safeParse(result);
  if (!parsedOutput.success) {
    // A handler returning an unexpected shape is our bug, not the model's, and
    // must not be silently passed back into the conversation.
    throw new ToolOutputError(name, parsedOutput.error.issues);
  }

  return parsedOutput.data;
}
