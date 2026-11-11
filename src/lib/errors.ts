/** Error codes returned in `{ error: { code, message } }`. */
export type ErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "invalid_json"
  | "validation_error"
  | "conflict"
  | "tenant_not_configured"
  | "fic_not_connected"
  | "fic_reconnect_required"
  | "fic_error"
  | "rate_limited"
  | "internal_error";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ErrorBody {
  error: { code: ErrorCode; message: string; details?: unknown };
}

export function errorBody(code: ErrorCode, message: string, details?: unknown): ErrorBody {
  return { error: details === undefined ? { code, message } : { code, message, details } };
}

export function errorResponse(
  status: number,
  code: ErrorCode,
  message: string,
  init?: { details?: unknown; headers?: HeadersInit },
): Response {
  return Response.json(errorBody(code, message, init?.details), { status, headers: init?.headers });
}

/** Wraps a route handler so thrown {@link ApiError}s become JSON error responses. */
export function withErrors<Args extends unknown[]>(
  handler: (...args: Args) => Promise<Response>,
): (...args: Args) => Promise<Response> {
  return async (...args: Args) => {
    try {
      return await handler(...args);
    } catch (error) {
      if (error instanceof ApiError) {
        const retryAfter = (error.details as { retryAfterSeconds?: number } | undefined)?.retryAfterSeconds;
        return errorResponse(error.status, error.code, error.message, {
          details: error.details,
          headers: retryAfter ? { "Retry-After": String(retryAfter) } : undefined,
        });
      }
      console.error("[fic-invoicing] unhandled error", error);
      return errorResponse(500, "internal_error", "Internal server error");
    }
  };
}
