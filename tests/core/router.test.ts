import { router, findRoute, isRouteError, getRouterStats } from '@/core/router';

// Unique prefix per test file to avoid singleton conflicts
const P = '/tst-router';

describe('Router', () => {
  describe('static routes', () => {
    it('finds a registered GET route', () => {
      const handler = jest.fn();
      router.addRoute('GET', `${P}/hello`, handler);

      const result = findRoute(`${P}/hello`, 'GET');
      expect(result).not.toBeNull();
      expect(isRouteError(result!)).toBe(false);
      const route = result as { handler: Function; params: Record<string, string> };
      expect(route.handler).toBe(handler);
      expect(route.params).toEqual({});
    });

    it('returns null for an unregistered path', () => {
      expect(findRoute(`${P}/does-not-exist`, 'GET')).toBeNull();
    });

    it('trailing slashes are normalised', () => {
      const handler = jest.fn();
      router.addRoute('GET', `${P}/slash`, handler);
      const result = findRoute(`${P}/slash/`, 'GET');
      expect(result).not.toBeNull();
      expect(isRouteError(result!)).toBe(false);
    });
  });

  describe('dynamic routes', () => {
    it('extracts a single param', () => {
      const handler = jest.fn();
      router.addRoute('GET', `${P}/users/[id]`, handler);

      const result = findRoute(`${P}/users/123`, 'GET');
      expect(result).not.toBeNull();
      expect(isRouteError(result!)).toBe(false);
      const route = result as { handler: Function; params: Record<string, string> };
      expect(route.params).toEqual({ id: '123' });
      expect(route.handler).toBe(handler);
    });

    it('static segment wins over param when both match', () => {
      const staticHandler = jest.fn();
      const paramHandler = jest.fn();
      router.addRoute('GET', `${P}/items/featured`, staticHandler);
      router.addRoute('GET', `${P}/items/[id]`, paramHandler);

      const result = findRoute(`${P}/items/featured`, 'GET');
      expect(result).not.toBeNull();
      const route = result as { handler: Function; params: Record<string, string> };
      expect(route.handler).toBe(staticHandler);
    });
  });

  describe('method handling', () => {
    it('returns a 405 RouteError when method is not allowed', () => {
      router.addRoute('POST', `${P}/post-only`, jest.fn());

      const result = findRoute(`${P}/post-only`, 'GET');
      expect(result).not.toBeNull();
      expect(isRouteError(result!)).toBe(true);
      const err = result as { error: string; status: number; allowedMethods: string[] };
      expect(err.status).toBe(405);
      expect(err.allowedMethods).toContain('POST');
    });

    it('HEAD falls back to the GET handler', () => {
      const handler = jest.fn();
      router.addRoute('GET', `${P}/head-test`, handler);

      const result = findRoute(`${P}/head-test`, 'HEAD');
      expect(result).not.toBeNull();
      expect(isRouteError(result!)).toBe(false);
      const route = result as { handler: Function; params: Record<string, string> };
      expect(route.handler).toBe(handler);
    });

    it('method defaults to GET when not provided', () => {
      const handler = jest.fn();
      router.addRoute('GET', `${P}/default-method`, handler);

      const result = findRoute(`${P}/default-method`);
      expect(result).not.toBeNull();
      expect(isRouteError(result!)).toBe(false);
    });
  });

  describe('wildcard routes', () => {
    it('matches and captures the wildcard segment', () => {
      const handler = jest.fn();
      router.addRoute('GET', `${P}/assets/*`, handler);

      const result = findRoute(`${P}/assets/img/logo.png`, 'GET');
      expect(result).not.toBeNull();
      expect(isRouteError(result!)).toBe(false);
      const route = result as { handler: Function; params: Record<string, string> };
      expect(route.handler).toBe(handler);
      expect(route.params['*']).toBe('img/logo.png');
    });
  });

  describe('getRouterStats', () => {
    it('returns a routeCount greater than zero after routes are added', () => {
      const stats = getRouterStats();
      expect(stats.routeCount).toBeGreaterThan(0);
    });
  });
});
