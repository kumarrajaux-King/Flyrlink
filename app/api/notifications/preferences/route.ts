/**
 * GET /api/notifications/preferences — every type, with the caller's choices.
 * PUT /api/notifications/preferences — set the choice for one type.
 *
 * `isDefault` tells the UI whether a row reflects a decision the user made or
 * the platform's default, which is the difference between "you turned this off"
 * and "nobody has thought about it".
 *
 * A user may switch off the in-app channel for any type. For the short list of
 * types the routing rules keep in-app regardless — money moving, a dispute, an
 * approval waiting on them — the preference is still stored and still honoured
 * everywhere it can be, rather than being silently refused or silently ignored.
 */

import { prisma } from '../../../../lib/db/client';
import { parseJsonBody } from '../../../../lib/http/auth-context';
import { handleMessagingRequest } from '../../../../lib/http/messaging';
import { ok } from '../../../../lib/http/response';
import { updatePreferenceSchema } from '../../../../lib/validation/messaging';
import { listPreferences, updatePreference } from '../../../../services/notification/notification-service';

export async function GET(request: Request): Promise<Response> {
  return handleMessagingRequest(request, async (session, requestId) =>
    ok({ preferences: await listPreferences(prisma, session.actor) }, requestId),
  );
}

export async function PUT(request: Request): Promise<Response> {
  return handleMessagingRequest(request, async (session, requestId) => {
    const { type, ...channels } = await parseJsonBody(request, updatePreferenceSchema);
    return ok(await updatePreference(prisma, session.actor, type, channels), requestId);
  });
}
