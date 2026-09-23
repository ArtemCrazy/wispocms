import { BadRequestException } from '@nestjs/common';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';

const MAX_DOCUMENT_TEXT = 1_000_000;

type DocumentFile = {
  fileName: string;
  mediaType: string;
  data: Buffer;
};

export function canExtractDocument(mediaType: string): boolean {
  return (
    mediaType ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mediaType === 'application/pdf'
  );
}

export async function extractDocumentText(file: DocumentFile): Promise<string> {
  if (!canExtractDocument(file.mediaType))
    throw new BadRequestException(
      `Файл «${file.fileName}» пока нельзя передать подключённому AI. Выберите текстовый документ DOCX или PDF с доступным текстом.`,
    );

  let text: string;
  try {
    if (file.mediaType === 'application/pdf') {
      const parser = new PDFParse({ data: new Uint8Array(file.data) });
      try {
        text = (await parser.getText()).text;
      } finally {
        await parser.destroy();
      }
    } else {
      text = (await mammoth.extractRawText({ buffer: file.data })).value;
    }
  } catch {
    throw new BadRequestException(
      `Не удалось прочитать файл «${file.fileName}». Проверьте, что документ не повреждён и не защищён паролем.`,
    );
  }

  const normalized = text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
  if (!normalized || normalized.includes('\0'))
    throw new BadRequestException(
      `В файле «${file.fileName}» нет доступного текста. Для сканированного PDF добавьте текстовую версию.`,
    );
  if (normalized.length > MAX_DOCUMENT_TEXT)
    throw new BadRequestException(
      `Текст файла «${file.fileName}» слишком большой для одного запуска. Сократите документ.`,
    );
  return normalized;
}
