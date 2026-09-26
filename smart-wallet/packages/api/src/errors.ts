import { HTTPException } from 'hono/http-exception';
import { OracleError, RiskError } from '@wallet/core';
import { RouterError } from '@wallet/router';

/** HTTP status codes the API answers with. */
export type ApiStatus = 400 | 404 | 422 | 500 | 503;

/** Error body every failure is rendered as. */
export interface ApiErrorBody {
  error: string;
  code: string;
}

/** An error the API itself raised: carries the status it should be answered with. */
export class ApiError extends Error {
  constructor(
    readonly status: ApiStatus,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Maps any thrown value onto a status and a JSON error body. */
export function errorResponse(error: unknown): { status: ApiStatus; body: ApiErrorBody } {
  if (error instanceof ApiError) {
    return { status: error.status, body: { error: error.message, code: error.code } };
  }

  if (error instanceof RiskError) {
    if (error.code === 'INVALID_INPUT') {
      return { status: 400, body: { error: error.message, code: 'INVALID_INPUT' } };
    }
    if (error.code === 'ALL_FAILED') {
      return { status: 503, body: { error: error.message, code: 'ALL_FAILED' } };
    }
    // NO_PROVIDER is a deployment mistake, not a client mistake.
    return internal();
  }

  if (error instanceof OracleError) {
    if (error.code === 'SYMBOL_NOT_FOUND') {
      return { status: 404, body: { error: error.message, code: 'SYMBOL_NOT_FOUND' } };
    }
    if (error.code === 'ALL_FAILED') {
      return { status: 503, body: { error: error.message, code: 'ALL_FAILED' } };
    }
    return internal();
  }

  if (error instanceof RouterError) {
    if (error.code === 'NO_ROUTE') {
      return { status: 404, body: { error: error.message, code: 'NO_ROUTE' } };
    }
    if (error.code === 'AGGREGATOR_ERROR') {
      return { status: 503, body: { error: error.message, code: 'AGGREGATOR_ERROR' } };
    }
    if (error.code === 'INVALID_INPUT' || error.code === 'UNSUPPORTED_FAMILY') {
      return { status: 400, body: { error: error.message, code: error.code } };
    }
    return internal();
  }

  if (error instanceof HTTPException) {
    return {
      status: error.status as ApiStatus,
      body: { error: error.message, code: 'HTTP_ERROR' },
    };
  }

  return internal();
}

/** The 500 answer. The real error is never sent to the client. */
function internal(): { status: ApiStatus; body: ApiErrorBody } {
  return { status: 500, body: { error: 'Internal server error', code: 'INTERNAL' } };
}
