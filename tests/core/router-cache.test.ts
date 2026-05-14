import { router, findRoute, resetRouter } from '@/core/router';

beforeEach(() => resetRouter());

const CACHE_MAX = 1000;
const CACHE_EVICT = 100;

describe('Router cache eviction', () => {
  it('evicts the oldest entries (FIFO batch) when the cache overflows', () => {
    for (let i = 0; i < CACHE_MAX + 1; i++) {
      router.addRoute('GET', `/r/${i}`, () => {});
    }

    // Warm the cache with the first CACHE_MAX entries (insertion order: 0…999)
    for (let i = 0; i < CACHE_MAX; i++) {
      findRoute(`/r/${i}`, 'GET');
    }

    const internalCache: Map<string, unknown> = (router as any).cachedRoutes;
    expect(internalCache.size).toBe(CACHE_MAX);

    // One more lookup triggers eviction: oldest CACHE_EVICT entries are deleted
    findRoute(`/r/${CACHE_MAX}`, 'GET');

    // The CACHE_EVICT oldest keys (0…CACHE_EVICT-1) should be gone
    for (let i = 0; i < CACHE_EVICT; i++) {
      expect(internalCache.has(`GET:/r/${i}`)).toBe(false);
    }

    // Entries that were inserted later should still be present
    expect(internalCache.has(`GET:/r/${CACHE_EVICT}`)).toBe(true);
    expect(internalCache.size).toBe(CACHE_MAX - CACHE_EVICT + 1);
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
