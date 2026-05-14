const mockCpSync = jest.fn();
const mockExistsSync = jest.fn().mockReturnValue(false);
const mockReaddirSync = jest.fn().mockReturnValue([]);
const mockStatSync = jest.fn().mockReturnValue({ isDirectory: () => false });

jest.mock('fs', () => ({
  cpSync: (...args: any[]) => mockCpSync(...args),
  existsSync: (...args: any[]) => mockExistsSync(...args),
  readdirSync: (...args: any[]) => mockReaddirSync(...args),
  statSync: (...args: any[]) => mockStatSync(...args),
}));

import { init } from '@/cli/init';

const DEST = '/fake/dest';

let consoleSpy: jest.SpyInstance;

beforeEach(() => {
  mockCpSync.mockClear();
  mockExistsSync.mockReturnValue(false);
  mockReaddirSync.mockReturnValue([]);
  mockStatSync.mockReturnValue({ isDirectory: () => false });
  consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  consoleSpy.mockRestore();
});

function setupOneFile() {
  let calls = 0;
  mockReaddirSync.mockImplementation(() => {
    calls++;
    return calls === 1 ? ['index.ts'] : [];
  });
}

describe('init — console output', () => {
  it('logs the base scaffolding message for null platform', () => {
    init(null, DEST);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[zeno] Scaffolding base project'));
  });

  it('logs the netlify scaffolding message', () => {
    init('netlify', DEST);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[zeno] Scaffolding Netlify adapter'));
  });

  it('logs the vercel scaffolding message', () => {
    init('vercel', DEST);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[zeno] Scaffolding Vercel adapter'));
  });

  it('shows next steps for base project', () => {
    init(null, DEST);
    const logs: string[] = consoleSpy.mock.calls.map((c: any[]) => c[0]);
    expect(logs.some((l) => l.includes('npm install zeno'))).toBe(true);
    expect(logs.some((l) => l.includes('zeno dev'))).toBe(true);
  });

  it('shows zeno build in next steps for netlify', () => {
    init('netlify', DEST);
    const logs: string[] = consoleSpy.mock.calls.map((c: any[]) => c[0]);
    expect(logs.some((l) => l.includes('zeno build'))).toBe(true);
  });

  it('shows zeno build in next steps for vercel', () => {
    init('vercel', DEST);
    const logs: string[] = consoleSpy.mock.calls.map((c: any[]) => c[0]);
    expect(logs.some((l) => l.includes('zeno build'))).toBe(true);
  });
});

describe('init — template selection', () => {
  it('reads the base template directory for null platform', () => {
    init(null, DEST);
    const dirsRead: string[] = mockReaddirSync.mock.calls.map((c: any[]) => c[0]);
    expect(dirsRead.some((d) => d.includes('base'))).toBe(true);
  });

  it('reads the netlify template directory', () => {
    init('netlify', DEST);
    const dirsRead: string[] = mockReaddirSync.mock.calls.map((c: any[]) => c[0]);
    expect(dirsRead.some((d) => d.includes('netlify'))).toBe(true);
  });

  it('reads the vercel template directory', () => {
    init('vercel', DEST);
    const dirsRead: string[] = mockReaddirSync.mock.calls.map((c: any[]) => c[0]);
    expect(dirsRead.some((d) => d.includes('vercel'))).toBe(true);
  });
});

describe('init — file copying', () => {
  it('copies files that do not exist in the destination', () => {
    setupOneFile();
    init(null, DEST);
    expect(mockCpSync).toHaveBeenCalledTimes(1);
  });

  it('skips files that already exist in the destination', () => {
    setupOneFile();
    mockExistsSync.mockReturnValue(true);
    init(null, DEST);
    expect(mockCpSync).not.toHaveBeenCalled();
  });

  it('copies to the correct destination path', () => {
    setupOneFile();
    init(null, DEST);
    const [, dest] = mockCpSync.mock.calls[0];
    expect(dest).toContain(DEST);
  });

  it('recurses into subdirectories and copies nested files', () => {
    let calls = 0;
    mockReaddirSync.mockImplementation(() => {
      calls++;
      if (calls === 1) return ['routes'];
      if (calls === 2) return ['index.ts'];
      return [];
    });
    mockStatSync.mockImplementation((p: string) => ({
      isDirectory: () => p.endsWith('routes'),
    }));

    init(null, DEST);
    expect(mockCpSync).toHaveBeenCalledTimes(1);
    const [, dest] = mockCpSync.mock.calls[0];
    expect(dest).toContain('routes');
  });
});
