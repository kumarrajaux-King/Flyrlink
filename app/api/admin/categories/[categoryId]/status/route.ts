/**
 * POST /api/admin/categories/:categoryId/status — activate or deactivate a
 * category. Deactivation is HIGH risk and must be confirmed.
 */

import { handleAdminMutation } from '../../../../../../lib/http/admin';
import { categoryStatusSchema } from '../../../../../../lib/validation/admin';
import { setCategoryActive } from '../../../../../../services/admin/category-service';

interface RouteParams {
  readonly params: Promise<{ categoryId: string }>;
}

export async function POST(request: Request, { params }: RouteParams): Promise<Response> {
  const { categoryId } = await params;
  return handleAdminMutation(request, categoryStatusSchema, (actor, body, context) =>
    setCategoryActive({
      actor,
      categoryId,
      isActive: body.isActive,
      reason: body.reason,
      confirm: body.confirm,
      context,
    }),
  );
}
