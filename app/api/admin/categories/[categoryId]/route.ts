/**
 * PATCH /api/admin/categories/:categoryId — rename, re-describe, reorder or move
 * a category. The slug does not change. There is no DELETE: categories are
 * deactivated, never removed.
 */

import { handleAdminMutation } from '../../../../../lib/http/admin';
import { updateCategorySchema } from '../../../../../lib/validation/admin';
import { updateCategory } from '../../../../../services/admin/category-service';

interface RouteParams {
  readonly params: Promise<{ categoryId: string }>;
}

export async function PATCH(request: Request, { params }: RouteParams): Promise<Response> {
  const { categoryId } = await params;
  return handleAdminMutation(request, updateCategorySchema, (actor, body, context) =>
    updateCategory({
      actor,
      categoryId,
      name: body.name,
      description: body.description,
      parentId: body.parentId,
      orderIndex: body.orderIndex,
      reason: body.reason,
      context,
    }),
  );
}
