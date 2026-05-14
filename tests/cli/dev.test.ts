const mockGenerateManifest = jest.fn().mockResolvedValue(undefined);
const mockWatchRoutes = jest.fn().mockResolvedValue(undefined);
const mockExistsSync = jest.fn();
const mockReadFileSync = jest.fn();
const mockSpawn = jest.fn();

jest.mock('@/cli/build', () => ({
  generateManifest: (...args: any[]) => mockGenerateManifest(...args),
}));

jest.mock('@/cli/watch', () => ({
  watchRoutes: (...args: any[]) => mockWatchRoutes(...args),
}));

jest.mock('fs', () => ({
  existsSync: (...args: any[]) => mockExistsSync(...args),
  readFileSync: (...args: any[]) => mockReadFileSync(...args),
}));

jest.mock('child_process', () => ({
  spawn: (...args: any[]) => mockSpawn(...args),
}));

import { dev } from '@/cli/dev';

const CWD = '/fake/project';
const ROUTES = '/fake/routes';

let cwdSpy: jest.SpyInstance;
let processSpy: jest.SpyInstance;
let consoleSpy: jest.SpyInstance;
let originalVercel: string | undefined;
let originalNetlify: string | undefined;

beforeEach(() => {
  mockGenerateManifest.mockClear();
  mockWatchRoutes.mockClear();
  mockExistsSync.mockReturnValue(false);
  mockReadFileSync.mockImplementation(() => { throw new Error('not found'); });
  mockSpawn.mockReturnValue({ on: jest.fn(), kill: jest.fn() });

  cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(CWD);
  processSpy = jest.spyOn(process, 'on').mockImplementation(jest.fn() as any);
  consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

  originalVercel = process.env.VERCEL;
  originalNetlify = process.env.NETLIFY;
  delete process.env.VERCEL;
  delete process.env.NETLIFY;
});

afterEach(() => {
  cwdSpy.mockRestore();
  processSpy.mockRestore();
  consoleSpy.mockRestore();
  jest.clearAllMocks();

  if (originalVercel !== undefined) process.env.VERCEL = originalVercel;
  else delete process.env.VERCEL;
  if (originalNetlify !== undefined) process.env.NETLIFY = originalNetlify;
  else delete process.env.NETLIFY;
});

describe('dev — VERCEL=1 environment', () => {
  beforeEach(() => { process.env.VERCEL = '1'; });
  afterEach(() => { delete process.env.VERCEL; });

  it('generates manifest and exits without watching or spawning', async () => {
    await dev(ROUTES);
    expect(mockGenerateManifest).toHaveBeenCalledWith(ROUTES);
    expect(mockWatchRoutes).not.toHaveBeenCalled();
    expect(mockSpawn).not.toHaveBeenCalled();
  });
});

describe('dev — NETLIFY=true environment', () => {
  beforeEach(() => { process.env.NETLIFY = 'true'; });
  afterEach(() => { delete process.env.NETLIFY; });

  it('starts the route watcher and exits without spawning', async () => {
    await dev(ROUTES);
    expect(mockWatchRoutes).toHaveBeenCalledWith(ROUTES);
    expect(mockGenerateManifest).not.toHaveBeenCalled();
    expect(mockSpawn).not.toHaveBeenCalled();
  });
});

describe('dev — platform detection (node mode)', () => {
  it('falls back to node when no platform markers are present', async () => {
    await dev(ROUTES);
    expect(mockWatchRoutes).toHaveBeenCalledWith(ROUTES);
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('falls back to node when package.json has no known deps', async () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ dependencies: {}, devDependencies: {} }));
    await dev(ROUTES);
    expect(mockSpawn).not.toHaveBeenCalled();
  });
});

describe('dev — platform detection (netlify)', () => {
  it('detects netlify via netlify.toml and spawns netlify dev', async () => {
    mockExistsSync.mockImplementation((p: string) => p.endsWith('netlify.toml'));
    await dev(ROUTES);
    expect(mockSpawn).toHaveBeenCalledWith('netlify', ['dev'], expect.objectContaining({ cwd: CWD }));
  });

  it('detects netlify via netlify-cli in devDependencies', async () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ devDependencies: { 'netlify-cli': '*' } }));
    await dev(ROUTES);
    expect(mockSpawn).toHaveBeenCalledWith('netlify', ['dev'], expect.any(Object));
  });

  it('detects netlify via @netlify/functions in dependencies', async () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ dependencies: { '@netlify/functions': '*' } }));
    await dev(ROUTES);
    expect(mockSpawn).toHaveBeenCalledWith('netlify', ['dev'], expect.any(Object));
  });
});

describe('dev — platform detection (vercel)', () => {
  it('detects vercel via vercel.json and spawns vercel dev', async () => {
    mockExistsSync.mockImplementation((p: string) => p.endsWith('vercel.json'));
    await dev(ROUTES);
    expect(mockSpawn).toHaveBeenCalledWith('vercel', ['dev'], expect.objectContaining({ cwd: CWD }));
  });

  it('detects vercel via vercel in dependencies', async () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ dependencies: { vercel: '*' } }));
    await dev(ROUTES);
    expect(mockSpawn).toHaveBeenCalledWith('vercel', ['dev'], expect.any(Object));
  });

  it('detects vercel via @vercel/node in devDependencies', async () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ devDependencies: { '@vercel/node': '*' } }));
    await dev(ROUTES);
    expect(mockSpawn).toHaveBeenCalledWith('vercel', ['dev'], expect.any(Object));
  });

  it('netlify.toml takes priority over vercel.json when both exist', async () => {
    mockExistsSync.mockReturnValue(true); // both files exist
    await dev(ROUTES);
    expect(mockSpawn).toHaveBeenCalledWith('netlify', ['dev'], expect.any(Object));
  });
});

describe('dev — non-node platform behaviour', () => {
  it('calls watchRoutes before spawning the platform CLI', async () => {
    mockExistsSync.mockImplementation((p: string) => p.endsWith('vercel.json'));
    const order: string[] = [];
    mockWatchRoutes.mockImplementation(async () => { order.push('watch'); });
    mockSpawn.mockImplementation(() => { order.push('spawn'); return { on: jest.fn(), kill: jest.fn() }; });

    await dev(ROUTES);
    expect(order).toEqual(['watch', 'spawn']);
  });

  it('registers SIGINT and SIGTERM forwarding to the child process', async () => {
    mockExistsSync.mockImplementation((p: string) => p.endsWith('netlify.toml'));
    await dev(ROUTES);
    const signals = processSpy.mock.calls.map((c: any[]) => c[0]);
    expect(signals).toContain('SIGINT');
    expect(signals).toContain('SIGTERM');
  });
});
