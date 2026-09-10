import { detectImageMimeType, readImageDimensions } from './image-signature';

describe('image signature detection', () => {
  it.each([
    ['image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xe0])],
    [
      'image/png',
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ],
    ['image/webp', Buffer.from('RIFF0000WEBPVP8 ', 'ascii')],
    ['image/gif', Buffer.from('GIF87a', 'ascii')],
    ['image/gif', Buffer.from('GIF89a', 'ascii')],
  ])('detects %s by its binary signature', (mimeType, buffer) => {
    expect(detectImageMimeType(buffer)).toBe(mimeType);
  });

  it('rejects an executable disguised as an image', () => {
    expect(
      detectImageMimeType(Buffer.from('<script>alert(1)</script>')),
    ).toBeNull();
  });

  it('rejects truncated signatures', () => {
    expect(detectImageMimeType(Buffer.from([0x89, 0x50, 0x4e]))).toBeNull();
    expect(detectImageMimeType(Buffer.from('RIFF', 'ascii'))).toBeNull();
  });

  it('reads dimensions from supported image headers', () => {
    const png = Buffer.alloc(24);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png);
    png.writeUInt32BE(1800, 16);
    png.writeUInt32BE(480, 20);
    expect(readImageDimensions(png, 'image/png')).toEqual({
      width: 1800,
      height: 480,
    });

    const gif = Buffer.from('GIF89a0000', 'ascii');
    gif.writeUInt16LE(640, 6);
    gif.writeUInt16LE(320, 8);
    expect(readImageDimensions(gif, 'image/gif')).toEqual({
      width: 640,
      height: 320,
    });

    const webp = Buffer.alloc(30);
    webp.write('RIFF', 0, 'ascii');
    webp.write('WEBPVP8X', 8, 'ascii');
    webp.writeUIntLE(1799, 24, 3);
    webp.writeUIntLE(479, 27, 3);
    expect(readImageDimensions(webp, 'image/webp')).toEqual({
      width: 1800,
      height: 480,
    });

    const jpeg = Buffer.from([
      0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0xe0, 0x07, 0x08, 0x03,
      0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
    ]);
    expect(readImageDimensions(jpeg, 'image/jpeg')).toEqual({
      width: 1800,
      height: 480,
    });
  });
});
