import { defaultConfig, getConfig } from '@/config/serverConfig';

describe('defaultConfig', () => {
  it('timeout default is 30 seconds', () => {
    expect(defaultConfig.timeout).toBe(30000);
  });

  it('getConfig merges custom values over defaults', () => {
    const config = getConfig({ timeout: 5000, port: 8080 });
    expect(config.timeout).toBe(5000);
    expect(config.port).toBe(8080);
    expect(config.platform).toBe('node'); // default preserved
  });

  it('getConfig without args returns defaults', () => {
    const config = getConfig();
    expect(config.timeout).toBe(30000);
    expect(config.port).toBe(3000);
  });
});
