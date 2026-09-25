/**
 * GET    /api/attachments/:id — a time-limited link to the file.
 * POST   /api/attachments/:id — confirm the upload (step 3 of 3).
 * DELETE /api/attachments/:id — withdraw a file you uploaded.
 *
 * Confirmation compares what landed in storage with what was declared when the
 * upload was reserved. An attachment that is never confirmed stays invisible:
 * it can never be carried by a message.
 */

import { prisma } from '../../../../lib/db/client';
import { requestContext } from '../../../../lib/http/auth-context';
import { handleMessagingRequest } from '../../../../lib/http/messaging';
import { ok } from '../../../../lib/http/response';
import { storageProvider } from '../../../../lib/storage/provider';
import {
  confirmUpload,
  deleteAttachment,
  getAttachmentDownload,
} from '../../../../services/messaging/attachment-service';

interface RouteParams {
  readonly params: Promise<{ attachmentId: string }>;
}

export async function GET(request: Request, { params }: RouteParams): Promise<Response> {
  const { attachmentId } = await params;
  return handleMessagingRequest(request, async (session, requestId) =>
    ok(await getAttachmentDownload(prisma, session.actor, attachmentId, storageProvider()), requestId),
  );
}

export async function POST(request: Request, { params }: RouteParams): Promise<Response> {
  const { attachmentId } = await params;
  return handleMessagingRequest(request, async (session, requestId) =>
    ok(
      await confirmUpload(
        prisma,
        session.actor,
        attachmentId,
        storageProvider(),
        requestContext(request, requestId),
      ),
      requestId,
    ),
  );
}

export async function DELETE(request: Request, { params }: RouteParams): Promise<Response> {
  const { attachmentId } = await params;
  return handleMessagingRequest(request, async (session, requestId) => {
    await deleteAttachment(prisma, session.actor, attachmentId, requestContext(request, requestId));
    return ok({ deleted: true }, requestId);
  });
}
