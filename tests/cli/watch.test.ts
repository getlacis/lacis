const mockGenerateManifest = jest.fn().mockResolvedValue(undefined);
const mockGenerateRouteTypes = jest.fn().mockResolvedValue(undefined);
const mockWatch = jest.fn();

jest.mock('@/cli/build', () => ({
  generateManifest: (...args: any[]) => mockGenerateManifest(...args),
  generateRouteTypes: (...args: any[]) => mockGenerateRouteTypes(...args),
}));

jest.mock('fs', () => ({
  watch: (...args: any[]) => mockWatch(...args),
}));

import { watchRoutes } from '@/cli/watch';

beforeEach(() => {
  jest.useFakeTimers();
  mockGenerateManifest.mockClear();
  mockWatch.mockClear();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('watchRoutes — startup', () => {
  it('calls generateManifest immediately on start', async () => {
    await watchRoutes('/fake/routes');
    expect(mockGenerateManifest).toHaveBeenCalledWith('/fake/routes');
    expect(mockGenerateManifest).toHaveBeenCalledTimes(1);
  });

  it('sets up a recursive fs.watch on the routesDir', async () => {
    await watchRoutes('/fake/routes');
    expect(mockWatch).toHaveBeenCalledWith(
      '/fake/routes',
      { recursive: true },
      expect.any(Function),
    );
  });
});

describe('watchRoutes — file change handling', () => {
  it('regenerates manifest after a 100 ms debounce on file change', async () => {
    await watchRoutes('/fake/routes');
    const cb: (event: string, filename: string) => void = mockWatch.mock.calls[0][2];

    cb('change', 'users/index.ts');
    expect(mockGenerateManifest).toHaveBeenCalledTimes(1); // still only the initial call

    jest.advanceTimersByTime(100);
    await Promise.resolve(); // flush async callback

    expect(mockGenerateManifest).toHaveBeenCalledTimes(2);
    expect(mockGenerateManifest).toHaveBeenLastCalledWith('/fake/routes');
  });

  it('ignores changes to _manifest.ts', async () => {
    await watchRoutes('/fake/routes');
    const cb: (event: string, filename: string) => void = mockWatch.mock.calls[0][2];

    cb('change', '_manifest.ts');
    jest.advanceTimersByTime(100);
    await Promise.resolve();

    expect(mockGenerateManifest).toHaveBeenCalledTimes(1); // no second call
  });

  it('ignores events with a null filename', async () => {
    await watchRoutes('/fake/routes');
    const cb: (event: string, filename: string | null) => void = mockWatch.mock.calls[0][2];

    cb('change', null);
    jest.advanceTimersByTime(100);
    await Promise.resolve();

    expect(mockGenerateManifest).toHaveBeenCalledTimes(1);
  });

  it('debounces rapid successive changes into a single manifest rebuild', async () => {
    await watchRoutes('/fake/routes');
    const cb: (event: string, filename: string) => void = mockWatch.mock.calls[0][2];

    cb('change', 'a.ts');
    cb('change', 'b.ts');
    cb('change', 'c.ts');

    jest.advanceTimersByTime(100);
    await Promise.resolve();

    // Only 2 total: 1 initial + 1 debounced (not 4)
    expect(mockGenerateManifest).toHaveBeenCalledTimes(2);
  });

  it('schedules a new debounce window after a previous one fires', async () => {
    await watchRoutes('/fake/routes');
    const cb: (event: string, filename: string) => void = mockWatch.mock.calls[0][2];

    cb('change', 'first.ts');
    jest.advanceTimersByTime(100);
    await Promise.resolve();

    cb('change', 'second.ts');
    jest.advanceTimersByTime(100);
    await Promise.resolve();

    expect(mockGenerateManifest).toHaveBeenCalledTimes(3); // initial + 2 debounced
  });
});
