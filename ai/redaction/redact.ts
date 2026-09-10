/**
 * PII redaction for AI payloads.
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
 */

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

interface ValueRule {
  readonly pattern: RegExp;
  readonly replacement: string;
}

/**
 * Order matters: longer/more specific patterns run first so a card number is not
 * partially consumed by a shorter numeric rule.
 */
const VALUE_RULES: readonly ValueRule[] = [
  // Emails
  { pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, replacement: '[EMAIL]' },
  // 13–19 digit card-shaped runs, optionally separated by spaces or dashes
  { pattern: /\b(?:\d[ -]?){13,19}\b/g, replacement: '[CARD]' },
  // International and local phone numbers (9–15 digits, optional +, separators)
  { pattern: /\+?\d[\d\s().-]{7,}\d/g, replacement: '[PHONE]' },
  // Provider secrets that must never appear even by accident
  { pattern: /\b(?:sk|pk|rzp)[-_](?:live|test)[-_][A-Za-z0-9]{8,}\b/gi, replacement: '[KEY]' },
  { pattern: /\bsk-ant-[A-Za-z0-9-]{8,}\b/g, replacement: '[KEY]' },
  { pattern: /\bAKIA[0-9A-Z]{16}\b/g, replacement: '[KEY]' },
  // Aadhaar-style 12-digit groups
  { pattern: /\b\d{4}\s\d{4}\s\d{4}\b/g, replacement: '[NATIONAL_ID]' },
];

/** Mask identifying values inside a single string. */
export function redactString(value: string): string {
  let output = value;
  for (const rule of VALUE_RULES) {
    output = output.replace(rule.pattern, rule.replacement);
  }
  return output;
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
export function redactPii(value: unknown, maxDepth = 12): unknown {
  return walk(value, maxDepth, new WeakSet<object>());
}

function walk(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (depth <= 0) return REDACTED;

  if (typeof value === 'string') return redactString(value);
  if (value === null || typeof value !== 'object') return value;

  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((entry) => walk(entry, depth - 1, seen));
  }

  if (value instanceof Date) return value.toISOString();

  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    output[key] = isSensitiveKey(key) ? REDACTED : walk(entry, depth - 1, seen);
  }
  return output;
}

/**
 * Redact and return a value ready for a Prisma Json column.
 *
 * Returns `Prisma.InputJsonValue` rather than `Record<string, unknown>` so the
 * cast lives here once, at the storage boundary, instead of at every call site.
 * The round-trip through JSON also strips `undefined`, which Prisma rejects.
 */
export function redactForStorage(value: unknown): Prisma.InputJsonValue {
  const redacted = redactPii(value);
  const serialisable: unknown =
    redacted !== null && typeof redacted === 'object' && !Array.isArray(redacted)
      ? redacted
      : { value: redacted ?? null };
  return JSON.parse(JSON.stringify(serialisable)) as Prisma.InputJsonValue;
}
