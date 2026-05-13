import http from 'http';
import https from 'https';

jest.mock('@/core/router', () => ({
  loadRoutes: jest.fn().mockResolvedValue(true),
  findRoute: jest.fn().mockReturnValue(null),
}));

jest.mock('@/core/middleware', () => ({
  runMiddlewares: jest.fn().mockResolvedValue(true),
}));

import { nodeAdapter } from '@/adapters/node';

type MockServer = {
  listen: jest.Mock;
  on: jest.Mock;
  close: jest.Mock;
};

const mockServer: MockServer = {
  listen: jest.fn((_port: number, cb?: () => void) => { cb?.(); return mockServer; }),
  on: jest.fn().mockReturnThis(),
  close: jest.fn(),
};

const baseConfig = {
  port: 3002,
  isDev: false,
  cluster: { enabled: false },
  monitoring: { enabled: false },
};

describe('nodeAdapter — HTTP vs HTTPS', () => {
  let httpSpy: jest.SpyInstance;
  let httpsSpy: jest.SpyInstance;

  beforeEach(() => {
    httpSpy  = jest.spyOn(http,  'createServer').mockReturnValue(mockServer as any);
    httpsSpy = jest.spyOn(https, 'createServer').mockReturnValue(mockServer as any);
  });

  afterEach(() => {
    httpSpy.mockRestore();
    httpsSpy.mockRestore();
  });

  it('uses http.createServer when httpsOptions is not provided', async () => {
    const handler = nodeAdapter.createHandler('routes');
    await (handler as Function)(baseConfig);

    expect(httpSpy).toHaveBeenCalledTimes(1);
    expect(httpsSpy).not.toHaveBeenCalled();
  });

  it('uses https.createServer when httpsOptions is provided', async () => {
    const handler = nodeAdapter.createHandler('routes');
    const httpsOptions = { cert: 'cert', key: 'key' };
    await (handler as Function)({ ...baseConfig, httpsOptions });

    expect(httpsSpy).toHaveBeenCalledTimes(1);
    expect(httpsSpy).toHaveBeenCalledWith(httpsOptions, expect.any(Function));
    expect(httpSpy).not.toHaveBeenCalled();
  });
});
