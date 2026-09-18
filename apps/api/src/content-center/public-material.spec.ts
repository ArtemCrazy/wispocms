import { materialText, publicIpv4, publicMaterialUrl } from './public-material';

describe('material import boundaries', () => {
  it.each([
    'http://example.com',
    'file:///etc/passwd',
    'https://127.0.0.1',
    'https://2130706433',
    'https://[::1]',
    'https://user:password@example.com',
    'https://example.com:8443',
    'https://host.internal',
  ])('rejects an unsafe URL: %s', (value) => {
    expect(() => publicMaterialUrl(value)).toThrow();
  });
  it.each([
    '127.0.0.1',
    '10.0.1.2',
    '169.254.169.254',
    '172.31.0.1',
    '192.168.1.1',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '198.18.1.1',
  ])('rejects a nonpublic resolved address: %s', (address) =>
    expect(publicIpv4(address)).toBe(false),
  );
  it('accepts public DNS addresses and removes page fragments', () => {
    expect(publicIpv4('93.184.215.14')).toBe(true);
    expect(publicMaterialUrl('https://example.com/about#team').href).toBe(
      'https://example.com/about',
    );
  });
  it('removes scripts and layout tags without rendering HTML', () => {
    expect(
      materialText(
        '<script>steal()</script><style>body{}</style><h1>Компания</h1><p>Факты &amp; данные</p>',
        true,
      ),
    ).toBe('Компания Факты & данные');
  });
  it('rejects oversized or malformed files instead of silently truncating', () => {
    expect(() => materialText('x'.repeat(40001), false)).toThrow();
    expect(() => materialText('wrong\uFFFD', false)).toThrow();
    expect(() => materialText('binary\0', false)).toThrow();
  });
});
