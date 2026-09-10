/**
 * Stable hash of a system prompt.
 *
 * Recorded on `AiAgentVersion` so a prompt edit under an unchanged version number
 * is detectable. Without it, "which prompt produced this run" becomes
 * unanswerable the moment someone tweaks a string.
 */

import { createHash } from 'node:crypto';

export function promptHash(prompt: string): string {
  return createHash('sha256').update(prompt, 'utf8').digest('hex').slice(0, 32);
}
