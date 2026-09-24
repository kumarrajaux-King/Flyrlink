/**
 * GET /api/admin/audit-logs — the audit log, scoped to the caller's remit
 * (`audit:read:any`). Read-only; there is no endpoint that edits or deletes an
 * audit record.
 */

import { handleAdminRead } from '../../../../lib/http/admin';
import { auditLogQuerySchema } from '../../../../lib/validation/admin';
import { listAuditLogs } from '../../../../services/admin/audit-service';

export function GET(request: Request): Promise<Response> {
  return handleAdminRead(request, auditLogQuerySchema, (actor, query) => listAuditLogs({ actor, ...query }));
}
