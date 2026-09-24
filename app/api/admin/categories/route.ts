/**
 * GET  /api/admin/categories — the category tree, including inactive
 *                              categories on request (`config:read:any`).
 * POST /api/admin/categories — create a category (`config:update:any`,
 *                              SUPER_ADMIN with MFA).
 */

import { handleAdminMutation, handleAdminRead } from '../../../../lib/http/admin';
import { categoryTreeQuerySchema, createCategorySchema } from '../../../../lib/validation/admin';
import { createCategory, getCategoryTree } from '../../../../services/admin/category-service';

export function GET(request: Request): Promise<Response> {
  return handleAdminRead(request, categoryTreeQuerySchema, (actor, query) =>
    getCategoryTree({ actor, includeInactive: query.includeInactive === 'true' }),
  );
}

export function POST(request: Request): Promise<Response> {
  return handleAdminMutation(
    request,
    createCategorySchema,
    (actor, body, context) =>
      createCategory({
        actor,
        name: body.name,
        slug: body.slug,
        description: body.description,
        parentId: body.parentId,
        orderIndex: body.orderIndex,
        reason: body.reason,
        context,
      }),
    { created: true },
  );
}
