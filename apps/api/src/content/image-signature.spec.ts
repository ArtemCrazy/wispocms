import { detectImageMimeType } from './image-signature';

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
});
