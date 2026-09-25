/**
 * PUT /api/attachments/content?key=… — upload bytes (development adapter only).
 * GET /api/attachments/content?key=… — download bytes (development adapter only).
 *
 * WHY THIS ROUTE EXISTS AT ALL
 *   With real object storage the client talks to the bucket directly and these
 *   handlers are never reached — `storageProvider()` returns a remote adapter
 *   whose tickets point at the bucket. The development adapter has no service to
 *   sign a URL against, so the same three-step flow is completed here instead,
 *   with the authorisation the ticket would have carried applied explicitly.
 *
 * SERVING RULES
 *   Every download is sent as an attachment, with `nosniff`. The allow-list
 *   includes SVG, which a browser will execute as a document if invited to —
 *   these two headers are what make sure it is never invited to. The
 *   `Content-Type` sent is the declared, validated type; the browser is given no
 *   opportunity to decide for itself.
 */

import { MAX_ATTACHMENT_BYTES } from '../../../../domain/attachment/rules';
import { prisma } from '../../../../lib/db/client';
import { handleMessagingRequest } from '../../../../lib/http/messaging';
import { fail, ok } from '../../../../lib/http/response';
import { LocalFilesystemStorage, storageProvider } from '../../../../lib/storage/provider';
import { authorizeKeyAccess } from '../../../../services/messaging/attachment-service';

/** The development adapter, or null when a real provider is in use. */
function localStorageAdapter(): LocalFilesystemStorage | null {
  const provider = storageProvider();
  return provider instanceof LocalFilesystemStorage ? provider : null;
}

function keyFrom(request: Request): string | null {
  const key = new URL(request.url).searchParams.get('key');
  return key && key.length > 0 && key.length <= 512 ? key : null;
}

export async function PUT(request: Request): Promise<Response> {
  return handleMessagingRequest(request, async (session, requestId) => {
    const storage = localStorageAdapter();
    if (!storage) return fail('NOT_FOUND', 'No such endpoint.', 404, requestId);

    const key = keyFrom(request);
    if (!key) return fail('VALIDATION_FAILED', 'A storage key is required.', 422, requestId);

    // Throws if this caller may not write to this key.
    await authorizeKeyAccess(prisma, session.actor, key, 'WRITE');

    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength === 0) {
      return fail('VALIDATION_FAILED', 'The uploaded file is empty.', 422, requestId);
    }
    if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
      return fail('ATTACHMENT_REJECTED', 'The uploaded file is too large.', 413, requestId);
    }

    await storage.put(key, bytes);
    return ok({ stored: true, sizeBytes: bytes.byteLength }, requestId, 201);
  });
}

export async function GET(request: Request): Promise<Response> {
  return handleMessagingRequest(request, async (session, requestId) => {
    const storage = localStorageAdapter();
    if (!storage) return fail('NOT_FOUND', 'No such endpoint.', 404, requestId);

    const key = keyFrom(request);
    if (!key) return fail('VALIDATION_FAILED', 'A storage key is required.', 422, requestId);

    const { mimeType, fileName } = await authorizeKeyAccess(prisma, session.actor, key, 'READ');

    const bytes = await storage.get(key);
    if (!bytes) return fail('NOT_FOUND', 'No file has been uploaded for this attachment.', 404, requestId);

    return new Response(bytes, {
      status: 200,
      headers: {
        'content-type': mimeType,
        'content-length': String(bytes.byteLength),
        // Never rendered in place, never sniffed. See the module note.
        'content-disposition': `attachment; filename="${fileName.replace(/"/g, '')}"`,
        'x-content-type-options': 'nosniff',
        'cache-control': 'private, no-store',
        'x-request-id': requestId,
      },
    });
  });
}
