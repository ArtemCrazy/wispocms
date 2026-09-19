import { BadRequestException } from '@nestjs/common';
import { extname } from 'node:path';
import { materialText } from './public-material';

export const MATERIAL_FILE_LIMIT = 10 * 1024 * 1024;
export type MaterialUpload = { originalname: string; buffer: Buffer };

const mediaTypes: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.docx':
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx':
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
};

export function validateMaterialFile(file?: MaterialUpload) {
  if (!file?.buffer?.length)
    throw new BadRequestException('Выберите непустой файл');
  if (file.buffer.length > MATERIAL_FILE_LIMIT)
    throw new BadRequestException('Файл должен быть не больше 10 МБ');
  // Multer decodes multipart filenames as latin1; repair a UTF-8 filename, not a true latin1 name.
  let fileName = file.originalname;
  if ([...fileName].every((character) => character.charCodeAt(0) <= 255)) {
    const decoded = Buffer.from(fileName, 'latin1').toString('utf8');
    if (!decoded.includes('\uFFFD')) fileName = decoded;
  }
  fileName = fileName
    .replaceAll('\\', '/')
    .split('/')
    .pop()!
    .split('')
    .filter(
      (character) =>
        character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127,
    )
    .join('')
    .trim();
  if (!fileName || fileName.length > 200)
    throw new BadRequestException(
      'Имя файла должно содержать от 1 до 200 символов',
    );
  const extension = extname(fileName).toLowerCase();
  const mediaType = mediaTypes[extension];
  if (!mediaType)
    throw new BadRequestException(
      'Поддерживаются PDF, DOCX, XLSX, PPTX, PNG, JPG, TXT, MD и CSV',
    );
  const bytes = file.buffer;
  const matches =
    extension === '.pdf'
      ? bytes.subarray(0, 5).toString('ascii') === '%PDF-'
      : extension === '.png'
        ? bytes
            .subarray(0, 8)
            .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : ['.jpg', '.jpeg'].includes(extension)
          ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
          : ['.docx', '.xlsx', '.pptx'].includes(extension)
            ? bytes.subarray(0, 4).equals(Buffer.from([80, 75, 3, 4]))
            : true;
  if (!matches)
    throw new BadRequestException(
      'Содержимое файла не соответствует его расширению',
    );
  const content = mediaType.startsWith('text/')
    ? materialText(bytes.toString('utf8'), false)
    : '';
  return { fileName, mediaType, content, size: bytes.length, data: bytes };
}
