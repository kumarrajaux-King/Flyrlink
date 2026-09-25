/**
 * The browser's side of the API envelope.
 *
 * Every route answers `{ data }` or `{ error: { code, message, details?, requestId } }`
 * with stable codes (STEP 02 §8). This turns that into a discriminated result so
 * a page branches on `code` — never on message text, which is copy and will
 * change.
 *
 * It never throws for a refusal. A 403 is an answer, not an exception, and a
 * page that has to wrap every call in try/catch ends up treating "you may not
 * do that" the same as "the network died".
 */

export interface ApiFailure {
  readonly code: string;
  readonly message: string;
  readonly details?: Record<string, string[]> | undefined;
  readonly status: number;
}

export type ApiResult<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: ApiFailure };

export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method ?? 'GET',
      headers: { 'content-type': 'application/json' },
      // Same origin, so the session cookie travels without any client handling.
      credentials: 'same-origin',
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch {
    return {
      ok: false,
      error: { code: 'NETWORK', message: 'Could not reach the server. Check your connection and try again.', status: 0 },
    };
  }

  let payload: { data?: T; error?: { code: string; message: string; details?: Record<string, string[]> } } = {};
  try {
    payload = (await response.json()) as typeof payload;
  } catch {
    payload = {};
  }

  if (!response.ok || payload.error) {
    return {
      ok: false,
      error: {
        code: payload.error?.code ?? 'UNEXPECTED',
        message: payload.error?.message ?? 'Something went wrong. Please try again.',
        details: payload.error?.details,
        status: response.status,
      },
    };
  }

  return { ok: true, data: payload.data as T };
}

/** The first message for a field, from a validation failure's details. */
export function fieldError(error: ApiFailure | null, field: string): string | undefined {
  return error?.details?.[field]?.[0];
}
