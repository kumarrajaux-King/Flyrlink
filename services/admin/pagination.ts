/**
 * Cursor pagination for admin reads.
 *
 * The helpers moved to `lib/pagination.ts` in Phase 9, when the inbox and the
 * notification list needed the same cursor rules and "admin pagination" stopped
 * being an accurate name for them. This module re-exports them so every Phase 8
 * call site keeps working unchanged.
 */

export {
  DEFAULT_PAGE_SIZE,
  type Page,
  type PageRequest,
  iso,
  minor,
  newestFirst,
  oldestFirst,
  pageSize,
  toPage,
} from '../../lib/pagination';
