/**
 * PII redaction and identifier pseudonymisation for AI payloads.
 *
 * Applied at two boundaries, and it matters at both:
 *
 *   1. **Before egress** — what leaves for a third-party provider.
 *   2. **Before persistence** — `AiRun.inputPayload` / `outputPayload` are read
 *      by operators in the admin console and retained indefinitely.
 *
 * Redacting only at egress would leave the data sitting in our own database
 * forever; redacting only at persistence would still have shipped it to a
 * vendor. So both.
 *
 * Design notes
 *   - Value patterns (emails, phone numbers, card-shaped digits) are masked
 *     wherever they appear, including inside free prose, because a customer can
 *     paste a phone number into a project description.
 *   - Sensitive *keys* are masked regardless of their value's shape.
 *   - Structure is preserved so the model still sees a coherent object; only the
 *     identifying values are replaced.
 *
 * IDENTIFIERS ARE PSEUDONYMISED FOR EGRESS, KEPT WHOLE FOR STORAGE
 *   Our primary keys are UUIDv7 (T-04), and the agent has to be able to name a
 *   row it was told about when it calls a tool. Three things follow.
 *
 *   Masking a UUID to `[ID]` would destroy that ability, and corrupting one is
 *   worse still. So a UUID is always consumed as a single token, never partly
 *   eaten by a numeric rule.
 *
 *   **Leaving for a provider**, each UUID is swapped for a **surrogate UUID**:
 *   structurally valid, stable for the life of one run, meaningless outside it.
 *   The orchestrator translates surrogates back on the way into a tool, so the
 *   model never sees a real identifier and never needs to. Surrogates are minted
 *   as UUID **version 8** — the variant RFC 9562 reserves for custom use — so a
 *   surrogate can never be mistaken for, or collide with, one of our version 7
 *   primary keys. The mapping is random per run rather than a keyed hash of the
 *   identifier, because a hash would be stable across every run forever, which
 *   is exactly the linkable handle we are trying not to give away.
 *
 *   **Staying in our own database**, identifiers are left as they are: they are
 *   our foreign keys, the admin console needs to show which row an action
 *   targets, and a held approval executed hours later has nothing but the stored
 *   payload to work from. Pseudonymising there would protect nobody and break
 *   both. Redaction for storage therefore takes no context, and that is what
 *   makes the difference visible at the call site.
 *
 * ONE PASS, LEFT TO RIGHT
 *   The rules used to run as a sequence of whole-string passes, which meant a
 *   later rule could chew on what an earlier rule had already produced — and,
 *   worse, on the digit-and-dash runs inside a UUID. `018f3c2a-…-446655440000`
 *   came out as `018f3c2a-…-[PHONE]`: not a UUID any more, and a tool call built
 *   from it could only fail. Roughly a quarter of random UUIDs were hit.
 *
 *   `scan` below instead walks the string once, taking the leftmost match across
 *   every rule and breaking ties by rule order. A replacement is never rescanned,
 *   and a UUID is consumed whole before any numeric rule can see inside it.
 */

import { randomBytes } from 'node:crypto';

import type { Prisma } from '../../src/generated/prisma/client';

export const REDACTED = '[REDACTED]';

/** Keys whose values are always masked, matched case-insensitively. */
const SENSITIVE_KEYS = new Set([
  'password',
  'passwordhash',
  'newpassword',
  'currentpassword',
  'token',
  'rawtoken',
  'sessiontoken',
  'accesstoken',
  'refreshtoken',
  'apikey',
  'api_key',
  'secret',
  'mfasecret',
  'clientsecret',
  'authorization',
  'cookie',
  'ssn',
  'nationalid',
  'taxidentifier',
  'pan',
  'aadhaar',
  'cardnumber',
  'card_number',
  'cvv',
  'cvc',
  'iban',
  'accountnumber',
  'account_number',
  'routingnumber',
  'ifsc',
  'bankaccount',
  'idempotencykey',
]);

/**
 * A canonical UUID, not glued to a longer hex-or-dash token on either side.
 *
 * The guards stop a 36-character window of some larger opaque string being
 * mistaken for an identifier.
 */
const UUID_PATTERN =
  /(?<![0-9A-Za-z-])[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![0-9A-Za-z-])/gi;

/** Whether a string is exactly one UUID and nothing else. */
export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/**
 * The surrogate an identifier is shown as, for the life of one run or context.
 *
 * `surrogateFor` is idempotent: handed a surrogate this context already issued,
 * it returns it unchanged, so redacting an already-redacted payload is a no-op
 * rather than a second layer of indirection.
 */
export interface RedactionContext {
  /** The surrogate UUID standing in for a real identifier. */
  surrogateFor(identifier: string): string;
  /** The real identifier behind a surrogate, or undefined if it is not ours. */
  realFor(surrogate: string): string | undefined;
  /** How many distinct identifiers this context has pseudonymised. */
  readonly size: number;
}

/**
 * A structurally valid UUID that is not one of ours.
 *
 * Version nibble 8 (RFC 9562 "custom"), correct variant bits. Every primary key
 * in the schema is version 7, so a surrogate can never shadow a real row.
 */
function mintSurrogate(): string {
  const bytes = randomBytes(16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x80;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** A fresh, empty mapping. One per AI run. */
export function createRedactionContext(): RedactionContext {
  const forward = new Map<string, string>();
  const reverse = new Map<string, string>();

  return {
    surrogateFor(identifier: string): string {
      const key = identifier.toLowerCase();
      // Already a surrogate we issued — leave it exactly as it is.
      if (reverse.has(key)) return identifier;

      const existing = forward.get(key);
      if (existing) return existing;

      let surrogate = mintSurrogate();
      while (forward.has(surrogate) || reverse.has(surrogate)) surrogate = mintSurrogate();
      forward.set(key, surrogate);
      reverse.set(surrogate, identifier);
      return surrogate;
    },
    realFor(surrogate: string): string | undefined {
      return reverse.get(surrogate.toLowerCase());
    },
    get size(): number {
      return forward.size;
    },
  };
}

interface ValueRule {
  readonly pattern: RegExp;
  readonly replacement: string | ((match: string, context: RedactionContext | undefined) => string);
}

/**
 * Order breaks ties between rules that match at the same position, so the more
 * specific pattern has to come first: an email that happens to start with a card
 * number is an email, and a UUID is a UUID rather than the phone number hiding
 * in its last group.
 */
const VALUE_RULES: readonly ValueRule[] = [
  // Emails
  { pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, replacement: '[EMAIL]' },
  // Provider secrets that must never appear even by accident
  { pattern: /\b(?:sk|pk|rzp)[-_](?:live|test)[-_][A-Za-z0-9]{8,}\b/gi, replacement: '[KEY]' },
  { pattern: /\bsk-ant-[A-Za-z0-9-]{8,}\b/g, replacement: '[KEY]' },
  { pattern: /\bAKIA[0-9A-Z]{16}\b/g, replacement: '[KEY]' },
  // Identifiers: consumed whole so no numeric rule below can take a bite out of
  // one, then pseudonymised for egress or passed through for storage.
  { pattern: UUID_PATTERN, replacement: (match, context) => context?.surrogateFor(match) ?? match },
  // 13–19 digit card-shaped runs, optionally separated by spaces or dashes
  { pattern: /\b(?:\d[ -]?){13,19}\b/g, replacement: '[CARD]' },
  // Aadhaar-style 12-digit groups
  { pattern: /\b\d{4}\s\d{4}\s\d{4}\b/g, replacement: '[NATIONAL_ID]' },
  // International and local phone numbers (9–15 digits, optional +, separators).
  // The guards keep the run from starting or ending part-way through a longer
  // alphanumeric token.
  { pattern: /(?<![\w.-])\+?\d[\d\s().-]{7,}\d(?![\w-])/g, replacement: '[PHONE]' },
];

/**
 * Walk `value` once, replacing the leftmost match of any rule.
 *
 * Ties at the same index go to the earlier rule. What a rule produces is never
 * looked at again, so replacements cannot cascade.
 */
function scan(value: string, context: RedactionContext | undefined): string {
  let output = '';
  let index = 0;

  while (index <= value.length) {
    let bestRule: ValueRule | null = null;
    let bestMatch: RegExpExecArray | null = null;

    for (const rule of VALUE_RULES) {
      rule.pattern.lastIndex = index;
      const match = rule.pattern.exec(value);
      if (!match) continue;
      if (bestMatch === null || match.index < bestMatch.index) {
        bestRule = rule;
        bestMatch = match;
      }
      if (bestMatch.index === index) break;
    }

    if (bestRule === null || bestMatch === null) break;

    output += value.slice(index, bestMatch.index);
    output +=
      typeof bestRule.replacement === 'string'
        ? bestRule.replacement
        : bestRule.replacement(bestMatch[0], context);
    index = bestMatch.index + bestMatch[0].length;
  }

  return output + value.slice(index);
}

/**
 * Mask identifying values inside a single string.
 *
 * With a context, UUIDs come back as that context's surrogates; without one they
 * come back unchanged — intact either way.
 */
export function redactString(value: string, context?: RedactionContext): string {
  return scan(value, context);
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key.toLowerCase().replace(/[^a-z0-9]/g, ''));
}

/**
 * Deep-redact any JSON-like value.
 *
 * `maxDepth` guards against a pathological or cyclic structure exhausting the
 * stack; a visited set handles genuine cycles.
 */
export function redactPii(value: unknown, context?: RedactionContext, maxDepth = 12): unknown {
  return walk(value, context, maxDepth, new WeakSet<object>());
}

function walk(
  value: unknown,
  context: RedactionContext | undefined,
  depth: number,
  seen: WeakSet<object>,
): unknown {
  if (depth <= 0) return REDACTED;

  if (typeof value === 'string') return scan(value, context);
  if (value === null || typeof value !== 'object') return value;

  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((entry) => walk(entry, context, depth - 1, seen));
  }

  if (value instanceof Date) return value.toISOString();

  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    output[key] = isSensitiveKey(key) ? REDACTED : walk(entry, context, depth - 1, seen);
  }
  return output;
}

/**
 * Turn a model's surrogates back into the identifiers they stand for.
 *
 * The inverse of the UUID rule, and the reason the agent can act on a row it was
 * only ever shown a surrogate of. A UUID this context did not issue is left
 * alone: it is either a real id the caller supplied itself, or something the
 * model invented, and in the second case the tool should fail to find it rather
 * than be handed a row at random.
 */
export function restoreIdentifiers(value: unknown, context: RedactionContext, maxDepth = 12): unknown {
  return restore(value, context, maxDepth, new WeakSet<object>());
}

function restore(value: unknown, context: RedactionContext, depth: number, seen: WeakSet<object>): unknown {
  if (depth <= 0) return value;

  if (typeof value === 'string') {
    return value.replace(UUID_PATTERN, (match) => context.realFor(match) ?? match);
  }
  if (value === null || typeof value !== 'object') return value;

  if (seen.has(value)) return value;
  seen.add(value);

  if (Array.isArray(value)) return value.map((entry) => restore(entry, context, depth - 1, seen));
  if (value instanceof Date) return value;

  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    output[key] = restore(entry, context, depth - 1, seen);
  }
  return output;
}

/**
 * Redact and return a value ready for a Prisma Json column.
 *
 * Returns `Prisma.InputJsonValue` rather than `Record<string, unknown>` so the
 * cast lives here once, at the storage boundary, instead of at every call site.
 * The round-trip through JSON also strips `undefined`, which Prisma rejects.
 *
 * Deliberately context-free: what we keep is ours, so identifiers stay real. See
 * the module header.
 */
export function redactForStorage(value: unknown): Prisma.InputJsonValue {
  const redacted = redactPii(value);
  const serialisable: unknown =
    redacted !== null && typeof redacted === 'object' && !Array.isArray(redacted)
      ? redacted
      : { value: redacted ?? null };
  return JSON.parse(JSON.stringify(serialisable)) as Prisma.InputJsonValue;
}
