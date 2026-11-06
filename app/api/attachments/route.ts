/**
 * POST /api/attachments — reserve an upload.
 *
 * Step 1 of 3. The response carries a ticket the client uploads the bytes with,
 * and an attachment id it confirms afterwards. Nothing is visible in a thread
 * until the upload is confirmed and a message carries it.
 */

import { prisma } from '../../../lib/db/client';
import { parseJsonBody } from '../../../lib/http/auth-context';
import { handleMessagingRequest } from '../../../lib/http/messaging';
import { ok } from '../../../lib/http/response';
import { reserveUploadSchema } from '../../../lib/validation/messaging';
import { reserveUpload } from '../../../services/messaging/attachment-service';

export async function POST(request: Request): Promise<Response> {
  return handleMessagingRequest(request, async (session, requestId) => {
    const body = await parseJsonBody(request, reserveUploadSchema);
    const reserved = await reserveUpload(prisma, session.actor, body);
    return ok(reserved, requestId, 201);
  });
}
