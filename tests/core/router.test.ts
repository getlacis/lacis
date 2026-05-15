import { router, findRoute, isRouteError, getRouterStats, resetRouter } from '@/core/router';

beforeEach(() => resetRouter());

describe('Router', () => {
  describe('static routes', () => {
    it('finds a registered GET route', () => {
      const handler = jest.fn();
      router.addRoute('GET', '/hello', handler);

      const result = findRoute('/hello', 'GET');
      expect(result).not.toBeNull();
      expect(isRouteError(result!)).toBe(false);
      const route = result as { handler: Function; params: Record<string, string> };
      expect(route.handler).toBe(handler);
      expect(route.params).toEqual({});
    });

    it('returns null for an unregistered path', () => {
      expect(findRoute('/does-not-exist', 'GET')).toBeNull();
    });

    it('trailing slashes are normalised', () => {
      const handler = jest.fn();
      router.addRoute('GET', '/slash', handler);
      const result = findRoute('/slash/', 'GET');
      expect(result).not.toBeNull();
      expect(isRouteError(result!)).toBe(false);
    });
  });

  describe('dynamic routes', () => {
    it('extracts a single param', () => {
      const handler = jest.fn();
      router.addRoute('GET', '/users/[id]', handler);

      const result = findRoute('/users/123', 'GET');
      expect(result).not.toBeNull();
      expect(isRouteError(result!)).toBe(false);
      const route = result as { handler: Function; params: Record<string, string> };
      expect(route.params).toEqual({ id: '123' });
      expect(route.handler).toBe(handler);
    });

    it('static segment wins over param when both match', () => {
      const staticHandler = jest.fn();
      const paramHandler = jest.fn();
      router.addRoute('GET', '/items/featured', staticHandler);
      router.addRoute('GET', '/items/[id]', paramHandler);

      const result = findRoute('/items/featured', 'GET');
      expect(result).not.toBeNull();
      const route = result as { handler: Function; params: Record<string, string> };
      expect(route.handler).toBe(staticHandler);
    });
  });

  describe('method handling', () => {
    it('returns a 405 RouteError when method is not allowed', () => {
      router.addRoute('POST', '/post-only', jest.fn());

      const result = findRoute('/post-only', 'GET');
      expect(result).not.toBeNull();
      expect(isRouteError(result!)).toBe(true);
      const err = result as { error: string; status: number; allowedMethods: string[] };
      expect(err.status).toBe(405);
      expect(err.allowedMethods).toContain('POST');
    });

    it('HEAD falls back to the GET handler', () => {
      const handler = jest.fn();
      router.addRoute('GET', '/head-test', handler);

      const result = findRoute('/head-test', 'HEAD');
      expect(result).not.toBeNull();
      expect(isRouteError(result!)).toBe(false);
      const route = result as { handler: Function; params: Record<string, string> };
      expect(route.handler).toBe(handler);
    });

    it('method defaults to GET when not provided', () => {
      const handler = jest.fn();
      router.addRoute('GET', '/default-method', handler);

      const result = findRoute('/default-method');
      expect(result).not.toBeNull();
      expect(isRouteError(result!)).toBe(false);
    });
  });

  describe('wildcard routes', () => {
    it('matches and captures the wildcard segment', () => {
      const handler = jest.fn();
      router.addRoute('GET', '/assets/*', handler);

      const result = findRoute('/assets/img/logo.png', 'GET');
      expect(result).not.toBeNull();
      expect(isRouteError(result!)).toBe(false);
      const route = result as { handler: Function; params: Record<string, string> };
      expect(route.handler).toBe(handler);
      expect(route.params['*']).toBe('img/logo.png');
    });
  });

  describe('getRouterStats', () => {
    it('returns routeCount=0 after reset', () => {
      expect(getRouterStats().routeCount).toBe(0);
    });

    it('returns a routeCount matching registered routes', () => {
      router.addRoute('GET', '/a', jest.fn());
      router.addRoute('POST', '/b', jest.fn());
      expect(getRouterStats().routeCount).toBe(2);
    });

    it('does not double-count when overwriting an existing method on the same route', () => {
      router.addRoute('GET', '/items', jest.fn());
      router.addRoute('GET', '/items', jest.fn());
      expect(getRouterStats().routeCount).toBe(1);
    });
  });

  describe('param name conflict', () => {
    it('throws when a different param name is used at the same path position', () => {
      router.addRoute('GET', '/users/[id]', jest.fn());
      expect(() => router.addRoute('POST', '/users/[userId]', jest.fn())).toThrow(
        /param name.*userId.*conflicts.*id/
      );
    });

    it('allows the same param name on different methods at the same position', () => {
      router.addRoute('GET', '/users/[id]', jest.fn());
      expect(() => router.addRoute('POST', '/users/[id]', jest.fn())).not.toThrow();
    });
  });
});
