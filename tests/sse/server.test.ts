import {
  initSSE,
  send,
  sendJson,
  sendEvent,
  sseComment,
  sseId,
  sseRetry,
  sseClose,
  sseEventError,
} from '@/sse/server';

function makeRes() {
  const written: string[] = [];
  let _ended = false;
  let _statusCode = 200;
  const _headers: Record<string, string> = {};
  const _listeners: Record<string, ((...args: any[]) => void)[]> = {};

  return {
    get statusCode() { return _statusCode; },
    set statusCode(v: number) { _statusCode = v; },
    get writableEnded() { return _ended; },
    written,
    get ended() { return _ended; },
    capturedHeaders: _headers,
    writeHead(code: number, hdrs?: Record<string, string>) {
      _statusCode = code;
      if (hdrs) Object.assign(_headers, hdrs);
      return this;
    },
    write(chunk: string): boolean {
      written.push(chunk);
      return true;
    },
    end(chunk?: string) {
      if (chunk !== undefined) written.push(chunk);
      _ended = true;
      (_listeners['close'] ?? []).forEach(cb => cb());
      return this;
    },
    on(event: string, cb: (...args: any[]) => void) {
      if (!_listeners[event]) _listeners[event] = [];
      _listeners[event].push(cb);
      return this;
    },
  };
}


describe('initSSE', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('sets Content-Type to text/event-stream', () => {
    const res = makeRes();
    initSSE(res as any);
    expect(res.capturedHeaders['Content-Type']).toBe('text/event-stream');
  });

  it('sets Cache-Control to no-cache by default', () => {
    const res = makeRes();
    initSSE(res as any);
    expect(res.capturedHeaders['Cache-Control']).toBe('no-cache');
  });

  it('sets Connection to keep-alive by default', () => {
    const res = makeRes();
    initSSE(res as any);
    expect(res.capturedHeaders['Connection']).toBe('keep-alive');
  });

  it('merges custom headers', () => {
    const res = makeRes();
    initSSE(res as any, { headers: { 'X-Accel-Buffering': 'no' } });
    expect(res.capturedHeaders['X-Accel-Buffering']).toBe('no');
    expect(res.capturedHeaders['Content-Type']).toBe('text/event-stream');
  });

  it('custom Cache-Control overrides default', () => {
    const res = makeRes();
    initSSE(res as any, { headers: { 'Cache-Control': 'no-store' } });
    expect(res.capturedHeaders['Cache-Control']).toBe('no-store');
  });

  it('calls res.end() after the specified timeout', () => {
    const res = makeRes();
    initSSE(res as any, { timeout: 5000 });
    expect(res.ended).toBe(false);
    jest.advanceTimersByTime(5000);
    expect(res.ended).toBe(true);
  });

  it('uses 300 000 ms as the default timeout', () => {
    const res = makeRes();
    initSSE(res as any);
    jest.advanceTimersByTime(299_999);
    expect(res.ended).toBe(false);
    jest.advanceTimersByTime(1);
    expect(res.ended).toBe(true);
  });

  it('clears the timeout when the connection closes', () => {
    const res = makeRes();
    initSSE(res as any, { timeout: 5000 });
    res.end();
    jest.advanceTimersByTime(5000);
    // end() was called once by us — should NOT be called a second time by the timer
    expect(res.written).toHaveLength(0);
  });

  it('returns the timeout id', () => {
    const res = makeRes();
    const id = initSSE(res as any);
    expect(id).toBeDefined();
  });
});


describe('send', () => {
  it('writes data: <value>\\n\\n', () => {
    const res = makeRes();
    send(res as any, 'hello');
    expect(res.written).toEqual(['data: hello\n\n']);
  });

  it('returns true when the write succeeds', () => {
    const res = makeRes();
    expect(send(res as any, 'hello')).toBe(true);
  });

  it('returns false and skips write when stream is ended', () => {
    const res = makeRes();
    res.end();
    expect(send(res as any, 'hello')).toBe(false);
    expect(res.written).toHaveLength(0);
  });

  it('propagates false from res.write() as backpressure signal', () => {
    const res = makeRes();
    res.write = jest.fn().mockReturnValue(false);
    expect(send(res as any, 'hello')).toBe(false);
  });
});


describe('sendJson', () => {
  it('serializes the object and writes data: <json>\\n\\n', () => {
    const res = makeRes();
    sendJson(res as any, { ok: true });
    expect(res.written).toEqual(['data: {"ok":true}\n\n']);
  });

  it('returns false and skips write when stream is ended', () => {
    const res = makeRes();
    res.end();
    expect(sendJson(res as any, { ok: true })).toBe(false);
    expect(res.written).toHaveLength(0);
  });

  it('propagates false from res.write() as backpressure signal', () => {
    const res = makeRes();
    res.write = jest.fn().mockReturnValue(false);
    expect(sendJson(res as any, {})).toBe(false);
  });
});


describe('sendEvent', () => {
  it('writes event: and data: lines', () => {
    const res = makeRes();
    sendEvent(res as any, 'update', { count: 1 });
    expect(res.written).toEqual(['event: update\n', 'data: {"count":1}\n\n']);
  });

  it('returns false and writes nothing when stream is ended', () => {
    const res = makeRes();
    res.end();
    expect(sendEvent(res as any, 'update', {})).toBe(false);
    expect(res.written).toHaveLength(0);
  });

  it('returns the result of the final write (backpressure)', () => {
    const res = makeRes();
    let callCount = 0;
    res.write = jest.fn().mockImplementation(() => {
      callCount++;
      return callCount < 2; // first write ok, second signals backpressure
    });
    expect(sendEvent(res as any, 'update', {})).toBe(false);
  });
});


describe('sseComment', () => {
  it('writes : <comment>\\n\\n', () => {
    const res = makeRes();
    sseComment(res as any, 'keep-alive');
    expect(res.written).toEqual([': keep-alive\n\n']);
  });

  it('returns false when stream is ended', () => {
    const res = makeRes();
    res.end();
    expect(sseComment(res as any, 'ping')).toBe(false);
    expect(res.written).toHaveLength(0);
  });
});


describe('sseId', () => {
  it('writes id: <value>\\n\\n', () => {
    const res = makeRes();
    sseId(res as any, 'abc-123');
    expect(res.written).toEqual(['id: abc-123\n\n']);
  });

  it('returns false when stream is ended', () => {
    const res = makeRes();
    res.end();
    expect(sseId(res as any, 'x')).toBe(false);
    expect(res.written).toHaveLength(0);
  });
});


describe('sseRetry', () => {
  it('writes retry: <ms>\\n\\n', () => {
    const res = makeRes();
    sseRetry(res as any, 3000);
    expect(res.written).toEqual(['retry: 3000\n\n']);
  });

  it('returns false when stream is ended', () => {
    const res = makeRes();
    res.end();
    expect(sseRetry(res as any, 1000)).toBe(false);
    expect(res.written).toHaveLength(0);
  });
});


describe('sseClose', () => {
  it('writes the default closing comment and calls end()', () => {
    const res = makeRes();
    sseClose(res as any);
    expect(res.written).toContain(': Connection closed\n\n');
    expect(res.ended).toBe(true);
  });

  it('writes a custom comment when provided', () => {
    const res = makeRes();
    sseClose(res as any, 'stream done');
    expect(res.written).toContain(': stream done\n\n');
    expect(res.ended).toBe(true);
  });
});


describe('sseEventError', () => {
  it('sets the given status code', () => {
    const res = makeRes();
    sseEventError(res as any, 'error', 'Something went wrong', 503);
    expect(res.statusCode).toBe(503);
  });

  it('defaults to status 500', () => {
    const res = makeRes();
    sseEventError(res as any, 'error', 'oops');
    expect(res.statusCode).toBe(500);
  });

  it('writes the event name', () => {
    const res = makeRes();
    sseEventError(res as any, 'auth_error', 'Unauthorized', 401);
    expect(res.written.some(c => c.includes('event: auth_error'))).toBe(true);
  });

  it('writes the error message and code in the data payload', () => {
    const res = makeRes();
    sseEventError(res as any, 'error', 'Not found', 404);
    const dataLine = res.written.find(c => c.startsWith('data:'));
    expect(dataLine).toBeDefined();
    const payload = JSON.parse(dataLine!.replace('data: ', ''));
    expect(payload.message).toBe('Not found');
    expect(payload.code).toBe(404);
    expect(payload.details).toBeNull();
  });

  it('includes details when provided', () => {
    const res = makeRes();
    sseEventError(res as any, 'error', 'Bad request', 400, 'field X is required');
    const dataLine = res.written.find(c => c.startsWith('data:'));
    const payload = JSON.parse(dataLine!.replace('data: ', ''));
    expect(payload.details).toBe('field X is required');
  });

  it('calls res.end()', () => {
    const res = makeRes();
    sseEventError(res as any, 'error', 'oops');
    expect(res.ended).toBe(true);
  });
});
