import { RequestCookiesImpl, ResponseCookiesImpl } from '@/utils/adapter-base';

describe('RequestCookiesImpl', () => {
  it('get() returns a single cookie value', () => {
    const c = new RequestCookiesImpl('session=abc123');
    expect(c.get('session')).toBe('abc123');
  });

  it('get() returns undefined for missing cookie', () => {
    const c = new RequestCookiesImpl('session=abc123');
    expect(c.get('token')).toBeUndefined();
  });

  it('get() handles multiple cookies', () => {
    const c = new RequestCookiesImpl('a=1; b=2; c=3');
    expect(c.get('a')).toBe('1');
    expect(c.get('b')).toBe('2');
    expect(c.get('c')).toBe('3');
  });

  it('all() returns all cookies as a record', () => {
    const c = new RequestCookiesImpl('x=foo; y=bar');
    expect(c.all()).toEqual({ x: 'foo', y: 'bar' });
  });

  it('all() returns empty object when header is missing', () => {
    const c = new RequestCookiesImpl(undefined);
    expect(c.all()).toEqual({});
  });

  it('decodes percent-encoded values', () => {
    const c = new RequestCookiesImpl('name=hello%20world');
    expect(c.get('name')).toBe('hello world');
  });

  it('strips surrounding quotes from values (RFC 6265)', () => {
    const c = new RequestCookiesImpl('name="hello world"');
    expect(c.get('name')).toBe('hello world');
  });

  it('parses lazily (only once)', () => {
    const raw = 'k=v';
    const c = new RequestCookiesImpl(raw);
    const first = c.all();
    const second = c.all();
    expect(first).toEqual(second);
  });
});

describe('ResponseCookiesImpl', () => {
  describe('set()', () => {
    it('serializes a simple cookie', () => {
      const c = new ResponseCookiesImpl();
      c.set('session', 'abc');
      expect(c.serialize()).toEqual(['session=abc; Path=/']);
    });

    it('encodes the value', () => {
      const c = new ResponseCookiesImpl();
      c.set('k', 'hello world');
      expect(c.serialize()[0]).toContain('hello%20world');
    });

    it('includes HttpOnly', () => {
      const c = new ResponseCookiesImpl();
      c.set('k', 'v', { httpOnly: true });
      expect(c.serialize()[0]).toContain('HttpOnly');
    });

    it('includes Secure', () => {
      const c = new ResponseCookiesImpl();
      c.set('k', 'v', { secure: true });
      expect(c.serialize()[0]).toContain('Secure');
    });

    it('includes SameSite', () => {
      const c = new ResponseCookiesImpl();
      c.set('k', 'v', { sameSite: 'Strict' });
      expect(c.serialize()[0]).toContain('SameSite=Strict');
    });

    it('includes Max-Age', () => {
      const c = new ResponseCookiesImpl();
      c.set('k', 'v', { maxAge: 3600 });
      expect(c.serialize()[0]).toContain('Max-Age=3600');
    });

    it('includes Expires', () => {
      const date = new Date('2030-01-01T00:00:00.000Z');
      const c = new ResponseCookiesImpl();
      c.set('k', 'v', { expires: date });
      expect(c.serialize()[0]).toContain(`Expires=${date.toUTCString()}`);
    });

    it('includes Domain', () => {
      const c = new ResponseCookiesImpl();
      c.set('k', 'v', { domain: '.example.com' });
      expect(c.serialize()[0]).toContain('Domain=.example.com');
    });

    it('uses custom Path', () => {
      const c = new ResponseCookiesImpl();
      c.set('k', 'v', { path: '/api' });
      expect(c.serialize()[0]).toContain('Path=/api');
    });

    it('omits Path when explicitly set to empty string', () => {
      const c = new ResponseCookiesImpl();
      c.set('k', 'v', { path: '' });
      expect(c.serialize()[0]).not.toContain('Path=');
    });

    it('is chainable', () => {
      const c = new ResponseCookiesImpl();
      c.set('a', '1').set('b', '2');
      expect(c.serialize()).toHaveLength(2);
    });
  });

  describe('delete()', () => {
    it('sets Max-Age=0 and past Expires', () => {
      const c = new ResponseCookiesImpl();
      c.delete('session');
      const serialized = c.serialize()[0];
      expect(serialized).toContain('session=');
      expect(serialized).toContain('Max-Age=0');
      expect(serialized).toContain('Expires=Thu, 01 Jan 1970');
    });

    it('forwards path and domain options', () => {
      const c = new ResponseCookiesImpl();
      c.delete('session', { path: '/app', domain: '.example.com' });
      const serialized = c.serialize()[0];
      expect(serialized).toContain('Path=/app');
      expect(serialized).toContain('Domain=.example.com');
    });
  });

  describe('serialize()', () => {
    it('returns empty array when no cookies set', () => {
      const c = new ResponseCookiesImpl();
      expect(c.serialize()).toEqual([]);
    });

    it('returns one string per cookie', () => {
      const c = new ResponseCookiesImpl();
      c.set('a', '1');
      c.set('b', '2');
      expect(c.serialize()).toHaveLength(2);
    });
  });
});
