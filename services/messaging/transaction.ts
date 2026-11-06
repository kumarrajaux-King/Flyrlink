/**
 * Run work in a transaction, whether or not one is already open.
 *
 * Messaging services are called both directly (from a route) and from inside a
 * lifecycle transaction (a state change that also posts a system message). A
 * nested `$transaction` is not available on a transaction client, so the shape
 * of the caller has to be detected rather than assumed. The Phase 6 engine
 * carries its own copy of this for the same reason.
 */

import type { Db, PrismaTransaction } from '../../lib/db/client';

export async function inTransaction<R>(db: Db, work: (tx: PrismaTransaction) => Promise<R>): Promise<R> {
  if ('$transaction' in db) return db.$transaction(work);
  return work(db as PrismaTransaction);
}
