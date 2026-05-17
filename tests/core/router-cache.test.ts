import { router, findRoute, resetRouter } from '@/core/router';

beforeEach(() => resetRouter());

const CACHE_MAX = 1000;
const CACHE_EVICT = 100;

describe('Router cache eviction', () => {
  it('evicts the least recently used entries when the cache overflows', () => {
    for (let i = 0; i < CACHE_MAX + 1; i++) {
      router.addRoute('GET', `/r/${i}`, () => {});
    }

    // Warm the cache: entries 0…999
    for (let i = 0; i < CACHE_MAX; i++) {
      findRoute(`/r/${i}`, 'GET');
    }

    const internalCache: Map<string, unknown> = (router as any).cachedRoutes;
    expect(internalCache.size).toBe(CACHE_MAX);

    // Re-access entries 0…CACHE_EVICT-1 — they should be promoted to MRU
    for (let i = 0; i < CACHE_EVICT; i++) {
      findRoute(`/r/${i}`, 'GET');
    }

    // One more miss triggers eviction: the CACHE_EVICT least recently used
    // are entries CACHE_EVICT…(2*CACHE_EVICT - 1), which were accessed earliest
    findRoute(`/r/${CACHE_MAX}`, 'GET');

    // The re-accessed entries (0…CACHE_EVICT-1) must still be present
    for (let i = 0; i < CACHE_EVICT; i++) {
      expect(internalCache.has(`GET:/r/${i}`)).toBe(true);
    }

    // The stale entries (CACHE_EVICT…2*CACHE_EVICT-1) should have been evicted
    for (let i = CACHE_EVICT; i < CACHE_EVICT * 2; i++) {
      expect(internalCache.has(`GET:/r/${i}`)).toBe(false);
    }

    expect(internalCache.size).toBe(CACHE_MAX - CACHE_EVICT + 1);
  });

  it('does not cache true 404s', () => {
    router.addRoute('GET', '/exists', () => {});

    findRoute('/does-not-exist', 'GET');
    findRoute('/also-missing', 'GET');

    const internalCache: Map<string, unknown> = (router as any).cachedRoutes;
    expect(internalCache.has('GET:/does-not-exist')).toBe(false);
    expect(internalCache.has('GET:/also-missing')).toBe(false);
  });

  it('caches 405 Method Not Allowed (route exists, wrong method)', () => {
    router.addRoute('POST', '/api/data', () => {});

    findRoute('/api/data', 'GET');

    const internalCache: Map<string, unknown> = (router as any).cachedRoutes;
    expect(internalCache.has('GET:/api/data')).toBe(true);
  });

  it('cache size stays bounded under sustained load', () => {
    for (let i = 0; i < CACHE_MAX + 500; i++) {
      router.addRoute('GET', `/load/${i}`, () => {});
    }
    for (let i = 0; i < CACHE_MAX + 500; i++) {
      findRoute(`/load/${i}`, 'GET');
    }

    const internalCache: Map<string, unknown> = (router as any).cachedRoutes;
    expect(internalCache.size).toBeLessThanOrEqual(CACHE_MAX);
  });
});
