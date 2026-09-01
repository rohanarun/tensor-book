export class ForumError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "ForumError";
    this.code = code;
    this.status = options.status ?? statusForCode(code);
    this.details = options.details ?? {};
    this.retryable = options.retryable ?? code === "STORAGE_BUSY";
  }
}

export function statusForCode(code) {
  switch (code) {
    case "VALIDATION_ERROR":
    case "INVALID_ARGUMENT":
      return 400;
    case "FORBIDDEN":
      return 403;
    case "NOT_FOUND":
      return 404;
    case "CONFLICT":
    case "CLAIM_CONFLICT":
    case "VERSION_CONFLICT":
    case "IDEMPOTENCY_CONFLICT":
      return 409;
    case "STORAGE_BUSY":
      return 503;
    default:
      return 500;
  }
}

export function normalizeError(error) {
  if (error instanceof ForumError) return error;
  if (error?.code === "VALIDATION_ERROR") {
    return new ForumError("VALIDATION_ERROR", error.message, {
      status: 400,
      details: { issues: error.details ?? [] },
    });
  }
  if (String(error?.code).startsWith("SQLITE_CONSTRAINT")) {
    return new ForumError("CONFLICT", "That record already exists.", {
      status: 409,
    });
  }
  if (String(error?.code).startsWith("SQLITE_BUSY")) {
    return new ForumError("STORAGE_BUSY", "The forum database is busy. Retry the same request.", {
      status: 503,
      retryable: true,
    });
  }
  return new ForumError("INTERNAL", error?.message ?? "Unexpected forum error.", {
    status: 500,
  });
}

export function errorPayload(error, requestId) {
  const normalized = normalizeError(error);
  return {
    ok: false,
    error: {
      code: normalized.code,
      message: normalized.message,
      retryable: normalized.retryable,
      details: normalized.details,
    },
    meta: {
      requestId: requestId ?? null,
      serverTime: new Date().toISOString(),
    },
  };
}
