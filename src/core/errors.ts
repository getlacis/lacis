import { ServerResponse } from "http";
import { primaryLog } from "@/utils/logs";

const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  CONFLICT: 409,
  UNPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
  GATEWAY_TIMEOUT: 504,
};

const DEFAULT_ERROR_MESSAGES: Record<number, string> = {
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  409: "Conflict",
  422: "Unprocessable Entity",
  429: "Too Many Requests",
  500: "Internal Server Error",
  503: "Service Unavailable",
  504: "Gateway Timeout",
};

interface HttpError {
  name: string;
  code: number;
  message: string;
  details?: any;
  expose: boolean;
  log: boolean;
  stack?: string;
}

function createHttpError(options: {
  name?: string;
  code?: number;
  message?: string;
  details?: any;
  expose?: boolean;
  log?: boolean;
}): HttpError {
  const code = options.code || HTTP_STATUS.INTERNAL_SERVER_ERROR;
  const message =
    options.message || DEFAULT_ERROR_MESSAGES[code] || "Unknown Error";
  const name = options.name || `HttpError${code}`;

  const stackCapture = new Error(message);
  Error.captureStackTrace?.(stackCapture, createHttpError);

  return {
    name,
    code,
    message,
    details: options.details,
    expose: options.expose !== undefined ? options.expose : code < 500,
    log: options.log !== undefined ? options.log : code >= 500,
    stack: stackCapture.stack,
  };
}

function errorToJSON(error: HttpError) {
  const result = {
    error: error.message,
    code: error.code,
  };

  if (error.expose && error.details) {
    return { ...result, details: error.details };
  }

  return result;
}

function sendError(error: HttpError, res: ServerResponse) {
  if (!res.headersSent) {
    res.statusCode = error.code;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(errorToJSON(error)));
  }

  if (error.log) {
    logError(error);
  }
}

function logError(error: HttpError) {
  const logData = {
    name: error.name,
    message: error.message,
    code: error.code,
    details: error.details,
    stack: error.stack,
  };

  if (error.code >= 500) {
    primaryLog("❌ ERROR:", JSON.stringify(logData, null, 2));
  } else {
    primaryLog("⚠️ WARNING:", JSON.stringify(logData, null, 2));
  }
}

function createBadRequestError(
  message?: string,
  details?: any
): HttpError {
  return createHttpError({
    name: "BadRequestError",
    code: HTTP_STATUS.BAD_REQUEST,
    message,
    details,
  });
}

function createUnauthorizedError(
  message?: string,
  details?: any
): HttpError {
  return createHttpError({
    name: "UnauthorizedError",
    code: HTTP_STATUS.UNAUTHORIZED,
    message,
    details,
  });
}

function createForbiddenError(
  message?: string,
  details?: any
): HttpError {
  return createHttpError({
    name: "ForbiddenError",
    code: HTTP_STATUS.FORBIDDEN,
    message,
    details,
  });
}

function createNotFoundError(
  message?: string,
  details?: any
): HttpError {
  return createHttpError({
    name: "NotFoundError",
    code: HTTP_STATUS.NOT_FOUND,
    message,
    details,
  });
}

function createMethodNotAllowedError(
  message?: string,
  details?: any
): HttpError {
  return createHttpError({
    name: "MethodNotAllowedError",
    code: HTTP_STATUS.METHOD_NOT_ALLOWED,
    message,
    details,
  });
}

function createConflictError(
  message?: string,
  details?: any
): HttpError {
  return createHttpError({
    name: "ConflictError",
    code: HTTP_STATUS.CONFLICT,
    message,
    details,
  });
}

function createValidationError(
  message?: string,
  details?: any
): HttpError {
  return createHttpError({
    name: "ValidationError",
    code: HTTP_STATUS.UNPROCESSABLE_ENTITY,
    message,
    details,
    expose: true,
  });
}

function createRateLimitError(
  message?: string,
  details?: any
): HttpError {
  return createHttpError({
    name: "RateLimitError",
    code: HTTP_STATUS.TOO_MANY_REQUESTS,
    message,
    details,
  });
}

function createInternalServerError(
  message?: string,
  details?: any
): HttpError {
  return createHttpError({
    name: "InternalServerError",
    code: HTTP_STATUS.INTERNAL_SERVER_ERROR,
    message,
    details,
  });
}

function createServiceUnavailableError(
  message?: string,
  details?: any
): HttpError {
  return createHttpError({
    name: "ServiceUnavailableError",
    code: HTTP_STATUS.SERVICE_UNAVAILABLE,
    message,
    details,
  });
}

function createGatewayTimeoutError(
  message?: string,
  details?: any
): HttpError {
  return createHttpError({
    name: "GatewayTimeoutError",
    code: HTTP_STATUS.GATEWAY_TIMEOUT,
    message,
    details,
  });
}

function normalizeError(error: any): HttpError {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    "message" in error
  ) {
    return error as HttpError;
  }

  const message = error?.message || "Unknown error occurred";
  const details = error?.stack ? { stack: error.stack } : undefined;
  const errorCode = error?.code || error?.statusCode;

  if (errorCode === "ECONNREFUSED" || errorCode === "ENOTFOUND") {
    return createServiceUnavailableError(
      `Service connection failed: ${message}`,
      details
    );
  }

  if (errorCode === "ETIMEDOUT") {
    return createGatewayTimeoutError(`Request timed out: ${message}`, details);
  }

  if (typeof errorCode === "number" && errorCode >= 400 && errorCode < 600) {
    return createHttpError({
      code: errorCode,
      message: message,
      details: details,
    });
  }

  return createInternalServerError(message, details);
}

function isHttpError(error: any): error is HttpError {
  return (
    error &&
    typeof error === "object" &&
    "code" in error &&
    "message" in error &&
    "name" in error
  );
}

export { HTTP_STATUS, isHttpError, normalizeError, sendError, logError, createBadRequestError, createUnauthorizedError, createForbiddenError, createNotFoundError, createMethodNotAllowedError, createConflictError, createValidationError, createRateLimitError, createInternalServerError, createServiceUnavailableError, createGatewayTimeoutError };