import {
  createHttpError,
  createBadRequestError,
  createUnauthorizedError,
  createForbiddenError,
  createNotFoundError,
  createMethodNotAllowedError,
  createConflictError,
  createValidationError,
  createRateLimitError,
  createInternalServerError,
  createServiceUnavailableError,
  createGatewayTimeoutError,
  normalizeError,
  isHttpError,
  sendError,
} from '@/core/errors';

describe('createHttpError', () => {
  it('uses the given code and message', () => {
    const err = createHttpError({ code: 418, message: "I'm a teapot" });
    expect(err.code).toBe(418);
    expect(err.message).toBe("I'm a teapot");
  });

  it('defaults to 500 with the standard message when nothing is provided', () => {
    const err = createHttpError({});
    expect(err.code).toBe(500);
    expect(err.message).toBe('Internal Server Error');
  });

  it('expose is true for 4xx errors', () => {
    expect(createHttpError({ code: 400 }).expose).toBe(true);
    expect(createHttpError({ code: 404 }).expose).toBe(true);
    expect(createHttpError({ code: 429 }).expose).toBe(true);
  });

  it('expose is false for 5xx errors', () => {
    expect(createHttpError({ code: 500 }).expose).toBe(false);
    expect(createHttpError({ code: 503 }).expose).toBe(false);
  });

  it('log is false for 4xx errors', () => {
    expect(createHttpError({ code: 400 }).log).toBe(false);
  });

  it('log is true for 5xx errors', () => {
    expect(createHttpError({ code: 500 }).log).toBe(true);
  });

  it('captures a stack trace', () => {
    const err = createHttpError({ code: 500 });
    expect(typeof err.stack).toBe('string');
    expect(err.stack!.length).toBeGreaterThan(0);
  });

  it('respects explicit expose override', () => {
    const err = createHttpError({ code: 500, expose: true });
    expect(err.expose).toBe(true);
  });
});

describe('specific error constructors', () => {
  const cases: [() => ReturnType<typeof createHttpError>, number][] = [
    [createBadRequestError, 400],
    [createUnauthorizedError, 401],
    [createForbiddenError, 403],
    [createNotFoundError, 404],
    [createMethodNotAllowedError, 405],
    [createConflictError, 409],
    [createValidationError, 422],
    [createRateLimitError, 429],
    [createInternalServerError, 500],
    [createServiceUnavailableError, 503],
    [createGatewayTimeoutError, 504],
  ];

  it.each(cases)('%p returns the correct status code', (factory, expectedCode) => {
    expect(factory().code).toBe(expectedCode);
  });

  it('accepts a custom message', () => {
    const err = createBadRequestError('Invalid email format');
    expect(err.message).toBe('Invalid email format');
  });

  it('accepts details payload', () => {
    const details = { field: 'email', reason: 'format' };
    const err = createValidationError('Validation failed', details);
    expect(err.details).toEqual(details);
  });

  it('createValidationError always exposes details', () => {
    const err = createValidationError('bad input', { field: 'name' });
    expect(err.expose).toBe(true);
  });
});

describe('normalizeError', () => {
  it('passes through a well-formed HttpError unchanged', () => {
    const original = createNotFoundError('not here');
    expect(normalizeError(original)).toStrictEqual(original);
  });

  it('wraps a plain Error as a 500', () => {
    const normalized = normalizeError(new Error('oops'));
    expect(normalized.code).toBe(500);
    expect(normalized.message).toBe('oops');
  });

  it('maps ECONNREFUSED to 503', () => {
    const err = Object.assign(new Error('refused'), { code: 'ECONNREFUSED' });
    expect(normalizeError(err).code).toBe(503);
  });

  it('maps ENOTFOUND to 503', () => {
    const err = Object.assign(new Error('not found'), { code: 'ENOTFOUND' });
    expect(normalizeError(err).code).toBe(503);
  });

  it('maps ETIMEDOUT to 504', () => {
    const err = Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' });
    expect(normalizeError(err).code).toBe(504);
  });

  it('uses a numeric statusCode as the HTTP code', () => {
    const err = Object.assign(new Error('gone'), { statusCode: 410 });
    expect(normalizeError(err).code).toBe(410);
  });

  it('handles null gracefully', () => {
    expect(normalizeError(null).code).toBe(500);
  });

  it('handles undefined gracefully', () => {
    expect(normalizeError(undefined).code).toBe(500);
  });
});

describe('isHttpError', () => {
  it('returns true for an HttpError object', () => {
    expect(isHttpError(createBadRequestError())).toBe(true);
  });

  it('returns false for a plain Error', () => {
    expect(isHttpError(new Error('plain'))).toBe(false);
  });

  it('returns false for null', () => {
    expect(isHttpError(null)).toBe(false);
  });

  it('returns false for a number', () => {
    expect(isHttpError(500)).toBe(false);
  });
});

describe('sendError', () => {
  function mockRes() {
    const captured: { statusCode: number; body: string } = { statusCode: 0, body: '' };
    const res: any = {
      headersSent: false,
      set statusCode(v: number) { captured.statusCode = v; },
      get statusCode() { return captured.statusCode; },
      setHeader() {},
      end(b: string) { captured.body = b; },
    };
    return { res, captured };
  }

  it('maps a 413 to "Payload Too Large" in the response body', () => {
    const { res, captured } = mockRes();
    // Mirrors the raw error thrown by nodeBody when the body exceeds maxBodySize
    sendError({ name: 'Error', code: 413, message: 'Payload Too Large', expose: false, log: false } as any, res);
    expect(captured.statusCode).toBe(413);
    expect(JSON.parse(captured.body)).toEqual({ error: 'Payload Too Large', code: 413 });
  });
});
