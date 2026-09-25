/**
 * Cursor pagination (T-10) and serialisation helpers.
 *
 * Every table uses UUIDv7 primary keys, which sort by creation time, so the id
 * is a stable cursor: no offset scans, and no skipped or repeated rows when
 * records are inserted between pages. Lists are newest first; work queues are
 * oldest first, so the longest-waiting case is at the top.
 *
 * These began life inside the admin control plane (Phase 8) and moved here in
 * Phase 9, when the inbox and the notification list needed exactly the same
 * cursor rules. `services/admin/pagination.ts` re-exports them, so no Phase 8
 * call site changed.
 */

import { MAX_PAGE_SIZE } from './validation/admin';

export const DEFAULT_PAGE_SIZE = 25;

export interface PageRequest {
  readonly cursor?: string | undefined;
  readonly limit?: number | undefined;
}

export interface Page<T> {
  readonly items: readonly T[];
  /** Pass back as `cursor` for the next page; null on the last page. */
  readonly nextCursor: string | null;
}

export function pageSize(limit: number | undefined): number {
  return Math.min(Math.max(Math.trunc(limit ?? DEFAULT_PAGE_SIZE), 1), MAX_PAGE_SIZE);
}

/** Newest-first cursor condition (`ORDER BY id DESC`). */
export function newestFirst(cursor: string | undefined): { id?: { lt: string } } {
  return cursor ? { id: { lt: cursor } } : {};
}

/** Oldest-first cursor condition (`ORDER BY id ASC`), for work queues. */
export function oldestFirst(cursor: string | undefined): { id?: { gt: string } } {
  return cursor ? { id: { gt: cursor } } : {};
}

/** Rows are fetched with `take: size + 1`; the extra row only signals another page. */
export function toPage<R extends { readonly id: string }, T>(rows: readonly R[], size: number, map: (row: R) => T): Page<T> {
  const hasMore = rows.length > size;
  const slice = hasMore ? rows.slice(0, size) : rows;
  return { items: slice.map(map), nextCursor: hasMore ? slice[slice.length - 1]!.id : null };
}

export function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

/** BigInt is not JSON-serialisable; a string keeps the exact minor-unit value (T-03). */
export function minor(value: bigint | null | undefined): string | null {
  return value === null || value === undefined ? null : value.toString();
}
