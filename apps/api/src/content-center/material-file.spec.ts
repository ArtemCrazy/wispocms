import { MATERIAL_FILE_LIMIT, validateMaterialFile } from './material-file';

describe('private project source files', () => {
  it('validates extension, signature, size and nonempty content', () => {
    expect(() => validateMaterialFile()).toThrow('непустой');
    expect(() =>
      validateMaterialFile({
        originalname: 'file.exe',
        buffer: Buffer.from('payload'),
      }),
    ).toThrow('Поддерживаются');
    expect(() =>
      validateMaterialFile({
        originalname: 'file.pdf',
        buffer: Buffer.from('<html>'),
      }),
    ).toThrow('расширению');
    expect(() =>
      validateMaterialFile({
        originalname: 'file.pdf',
        buffer: Buffer.alloc(MATERIAL_FILE_LIMIT + 1),
      }),
    ).toThrow('10 МБ');
    expect(() =>
      validateMaterialFile({
        originalname: 'file.txt',
        buffer: Buffer.from([255, 254, 0]),
      }),
    ).toThrow();
  });
  it('repairs multipart UTF-8 filenames and strips path/header control characters', () => {
    const name = Buffer.from('Бриф.txt', 'utf8').toString('latin1');
    expect(
      validateMaterialFile({
        originalname: name,
        buffer: Buffer.from('Компания'),
      }).fileName,
    ).toBe('Бриф.txt');
    expect(
      validateMaterialFile({
        originalname: '../folder\\brief\r\n.txt',
        buffer: Buffer.from('Text'),
      }).fileName,
    ).toBe('brief.txt');
  });
});
