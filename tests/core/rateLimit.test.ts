import { createRateLimit } from '@/core/rateLimit';
import type { Request, Response } from '@/types';

function makeReq(options: {
  headers?: Record<string, string>;
  remoteAddress?: string;
} = {}): Request {
  return {
    headers: options.headers ?? {},
    socket: options.remoteAddress ? { remoteAddress: options.remoteAddress } : {},
  } as unknown as Request;
}

function makeRes() {
  return {
    statusCode: 200,
    headersSent: false,
    setHeader: jest.fn(),
    end: jest.fn(),
  } as unknown as Response;
}

describe('createRateLimit — response headers', () => {
  let dateSpy: jest.SpyInstance;

  beforeEach(() => {
    dateSpy = jest.spyOn(Date, 'now').mockReturnValue(0);
  });

  afterEach(() => {
    dateSpy.mockRestore();
  });

  it('sets X-RateLimit-Limit', () => {
    const mw = createRateLimit({ max: 5 });
    const res = makeRes();
    mw(makeReq({ headers: { 'x-forwarded-for': '1.1.1.1' } }), res);
    expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', '5');
  });

  it('sets X-RateLimit-Remaining to max-1 on first request', () => {
    const mw = createRateLimit({ max: 5 });
    const res = makeRes();
    mw(makeReq({ headers: { 'x-forwarded-for': '1.1.1.1' } }), res);
    expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', '4');
  });

  it('decrements X-RateLimit-Remaining on subsequent requests', () => {
    const mw = createRateLimit({ max: 5 });
    const ip = { headers: { 'x-forwarded-for': '2.2.2.2' } };
    mw(makeReq(ip), makeRes());
    const res = makeRes();
    mw(makeReq(ip), res);
    expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', '3');
  });

  it('sets X-RateLimit-Reset based on windowMs', () => {
    const mw = createRateLimit({ max: 5, windowMs: 60_000 });
    const res = makeRes();
    mw(makeReq({ headers: { 'x-forwarded-for': '3.3.3.3' } }), res);
    expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Reset', '60');
  });

  it('clamps X-RateLimit-Remaining to 0 when past max', () => {
    const mw = createRateLimit({ max: 1 });
    const req = makeReq({ headers: { 'x-forwarded-for': '4.4.4.4' } });
    mw(req, makeRes()); // count=1
    const res = makeRes();
    mw(req, res);       // count=2, over limit
    expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', '0');
  });
});

describe('createRateLimit — enforcement', () => {
  let dateSpy: jest.SpyInstance;

  beforeEach(() => {
    dateSpy = jest.spyOn(Date, 'now').mockReturnValue(0);
  });

  afterEach(() => {
    dateSpy.mockRestore();
  });

  it('does not return false for requests within the limit', () => {
    const mw = createRateLimit({ max: 3 });
    const req = makeReq({ headers: { 'x-forwarded-for': '5.5.5.5' } });
    expect(mw(req, makeRes())).not.toBe(false);
    expect(mw(req, makeRes())).not.toBe(false);
    expect(mw(req, makeRes())).not.toBe(false);
  });

  it('returns false when count exceeds max', () => {
    const mw = createRateLimit({ max: 2 });
    const req = makeReq({ headers: { 'x-forwarded-for': '6.6.6.6' } });
    mw(req, makeRes());
    mw(req, makeRes());
    expect(mw(req, makeRes())).toBe(false);
  });

  it('sends 429 status code when blocked', () => {
    const mw = createRateLimit({ max: 1 });
    const req = makeReq({ headers: { 'x-forwarded-for': '7.7.7.7' } });
    mw(req, makeRes());
    const res = makeRes();
    mw(req, res);
    expect(res.statusCode).toBe(429);
  });

  it('sets Retry-After header when blocked', () => {
    const mw = createRateLimit({ max: 1, windowMs: 10_000 });
    const req = makeReq({ headers: { 'x-forwarded-for': '8.8.8.8' } });
    mw(req, makeRes());
    const res = makeRes();
    mw(req, res);
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', '10');
  });

  it('sends the custom message in the 429 body', () => {
    const mw = createRateLimit({ max: 0, message: 'slow down!' });
    const res = makeRes();
    mw(makeReq({ headers: { 'x-forwarded-for': '9.9.9.9' } }), res);
    const body = (res.end as jest.Mock).mock.calls[0]?.[0] as string;
    expect(JSON.parse(body).error).toBe('slow down!');
  });

  it('resets the counter after windowMs has elapsed', () => {
    const mw = createRateLimit({ max: 1, windowMs: 5_000 });
    const req = makeReq({ headers: { 'x-forwarded-for': 'A' } });

    mw(req, makeRes());
    expect(mw(req, makeRes())).toBe(false); // window not expired

    dateSpy.mockReturnValue(5_001);
    expect(mw(req, makeRes())).not.toBe(false); // new window
  });
});

describe('createRateLimit — key generation', () => {
  let dateSpy: jest.SpyInstance;

  beforeEach(() => {
    dateSpy = jest.spyOn(Date, 'now').mockReturnValue(0);
  });

  afterEach(() => {
    dateSpy.mockRestore();
  });

  it('keys by x-forwarded-for — different IPs have independent counters', () => {
    const mw = createRateLimit({ max: 1 });
    mw(makeReq({ headers: { 'x-forwarded-for': 'IP-A' } }), makeRes());
    mw(makeReq({ headers: { 'x-forwarded-for': 'IP-A' } }), makeRes()); // A blocked
    expect(mw(makeReq({ headers: { 'x-forwarded-for': 'IP-B' } }), makeRes())).not.toBe(false);
  });

  it('uses only the first IP from a comma-separated x-forwarded-for', () => {
    const mw = createRateLimit({ max: 1 });
    const req = makeReq({ headers: { 'x-forwarded-for': '1.1.1.1 , 2.2.2.2' } });
    mw(req, makeRes());
    expect(mw(req, makeRes())).toBe(false); // same first IP
  });

  it('falls back to socket.remoteAddress when header is absent', () => {
    const mw = createRateLimit({ max: 1 });
    mw(makeReq({ remoteAddress: 'sockA' }), makeRes());
    mw(makeReq({ remoteAddress: 'sockA' }), makeRes()); // sockA blocked
    expect(mw(makeReq({ remoteAddress: 'sockB' }), makeRes())).not.toBe(false);
  });

  it('falls back to "unknown" when neither header nor socket.remoteAddress is present', () => {
    const mw = createRateLimit({ max: 1 });
    mw(makeReq(), makeRes());
    expect(mw(makeReq(), makeRes())).toBe(false); // both keyed as "unknown"
  });

  it('accepts a custom keyGenerator', () => {
    const mw = createRateLimit({
      max: 1,
      keyGenerator: (req) => req.headers['x-user-id'] as string ?? 'anon',
    });
    const req = makeReq({ headers: { 'x-user-id': 'u42' } });
    mw(req, makeRes());
    expect(mw(req, makeRes())).toBe(false);
  });
});

describe('createRateLimit — store isolation', () => {
  it('each instance maintains its own independent store', () => {
    const mw1 = createRateLimit({ max: 1 });
    const mw2 = createRateLimit({ max: 1 });
    const req = makeReq({ headers: { 'x-forwarded-for': 'shared-ip' } });

    mw1(req, makeRes());
    mw1(req, makeRes()); // mw1 is now blocked

    expect(mw2(req, makeRes())).not.toBe(false); // mw2 store is independent
  });
});
