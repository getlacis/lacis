import { createTimeoutMiddleware } from '@/utils/timeout';
import type { Request, Response } from '@/types';
import { EventEmitter } from 'events';

function makeReqRes(headersSent = false) {
  const req = {} as Request;
  const res = Object.assign(new EventEmitter(), {
    headersSent,
    statusCode: 200,
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  }) as unknown as Response;
  return { req, res };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('createTimeoutMiddleware', () => {
  it('isTimedOut() returns false before the timeout fires', () => {
    const { req, res } = makeReqRes();
    createTimeoutMiddleware({ timeout: 1000 })(req, res);
    expect((req as any).isTimedOut()).toBe(false);
  });

  it('sends 408 and sets isTimedOut()=true when timeout fires', () => {
    const { req, res } = makeReqRes();
    createTimeoutMiddleware({ timeout: 1000 })(req, res);

    jest.advanceTimersByTime(1000);

    expect((req as any).isTimedOut()).toBe(true);
    expect((res as any).status).toHaveBeenCalledWith(408);
    expect((res as any).json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Request Timeout' }));
  });

  it('does not send 408 when headers are already sent', () => {
    const { req, res } = makeReqRes(true);
    createTimeoutMiddleware({ timeout: 500 })(req, res);

    jest.advanceTimersByTime(500);

    expect((res as any).status).not.toHaveBeenCalled();
    expect((res as any).json).not.toHaveBeenCalled();
  });

  it('cancels the timeout when the response emits finish', () => {
    const { req, res } = makeReqRes();
    createTimeoutMiddleware({ timeout: 1000 })(req, res);

    res.emit('finish');
    jest.advanceTimersByTime(1000);

    expect((req as any).isTimedOut()).toBe(false);
    expect((res as any).json).not.toHaveBeenCalled();
  });

  it('cancels the timeout when the response emits close', () => {
    const { req, res } = makeReqRes();
    createTimeoutMiddleware({ timeout: 1000 })(req, res);

    res.emit('close');
    jest.advanceTimersByTime(1000);

    expect((req as any).isTimedOut()).toBe(false);
    expect((res as any).json).not.toHaveBeenCalled();
  });

  it('is a no-op if called twice on the same response', () => {
    const { req, res } = makeReqRes();
    const mw = createTimeoutMiddleware({ timeout: 1000 });
    mw(req, res);
    mw(req, res);

    jest.advanceTimersByTime(1000);

    expect((res as any).json).toHaveBeenCalledTimes(1);
  });

  it('uses 300000ms as the default timeout', () => {
    const { req, res } = makeReqRes();
    createTimeoutMiddleware({})(req, res);

    jest.advanceTimersByTime(299_999);
    expect((res as any).json).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect((res as any).json).toHaveBeenCalled();
  });
});
