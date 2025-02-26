import { createTimeoutMiddleware } from '@/utils/timeout';
import type { Request, Response } from '@/types';
describe('Timeout Middleware', () => {
  test('basic functionality', () => {
    const req = {} as Request;
    const res = {
      headersSent: false,
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      once: jest.fn()
    } as unknown as Response;
    
    const middleware = createTimeoutMiddleware({ timeout: 1000 });
    middleware(req as any, res as any);

    expect(typeof (req as any).isTimedOut).toBeDefined();
    expect((req as any).isTimedOut()).toBe(false);

    expect(res.once).toHaveBeenCalledTimes(2);
  });
});