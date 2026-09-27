import type { Context } from 'hono';
import { ApiError } from './errors';

/**
 * Reads a JSON object from the request body.
 *
 * @throws ApiError 400 when the body is missing, not valid JSON, or not an
 *   object — all three are client mistakes, never internal errors.
 */
export async function readJsonObject(c: Context): Promise<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = await c.req.json();
  } catch {
    throw new ApiError(400, 'INVALID_JSON', 'request body must be valid JSON');
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ApiError(400, 'INVALID_BODY', 'request body must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}

/** Reads a body field that must be a non-empty string. */
export function requireString(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ApiError(400, 'INVALID_INPUT', `${field} is required and must be a non-empty string`);
  }
  return value;
}

/** Reads an optional body field that must be a non-empty string when present. */
export function optionalString(body: Record<string, unknown>, field: string): string | undefined {
  const value = body[field];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ApiError(400, 'INVALID_INPUT', `${field} must be a non-empty string when present`);
  }
  return value;
}
