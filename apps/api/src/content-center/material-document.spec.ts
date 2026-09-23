import JSZip from 'jszip';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { extractDocumentText } from './material-document';

async function docx(text: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    '_rels/.rels',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  zip.file(
    'word/document.xml',
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}

function pdf(text: string): Buffer {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let value = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(value.length);
    value += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = value.length;
  value += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1))
    value += `${String(offset).padStart(10, '0')} 00000 n \n`;
  value += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(value, 'ascii');
}

describe('document text extraction for text-only AI', () => {
  it('reads DOCX paragraphs', async () => {
    await expect(
      extractDocumentText({
        fileName: 'brief.docx',
        mediaType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        data: await docx('Company brief'),
      }),
    ).resolves.toBe('Company brief');
  });

  it('reads a text PDF', () => {
    // pdf.js uses a dynamic worker import that Jest's VM cannot run without
    // process-wide flags. Exercise the real adapter in a regular Node process.
    const script = `
      const { extractDocumentText } = require('./src/content-center/material-document');
      const chunks = [];
      process.stdin.on('data', chunk => chunks.push(chunk));
      process.stdin.on('end', async () => {
        try {
          const text = await extractDocumentText({
            fileName: 'brief.pdf', mediaType: 'application/pdf',
            data: Buffer.concat(chunks),
          });
          process.stdout.write(text);
        } catch (error) {
          process.stderr.write(String(error));
          process.exitCode = 1;
        }
      });
    `;
    const result = execFileSync(
      process.execPath,
      ['-r', 'ts-node/register', '-e', script],
      {
        cwd: resolve(__dirname, '../..'),
        input: pdf('Company brief'),
        encoding: 'utf8',
        timeout: 10_000,
      },
    );
    expect(result).toContain('Company brief');
  });

  it('fails explicitly for unreadable files and unsupported images', async () => {
    await expect(
      extractDocumentText({
        fileName: 'broken.docx',
        mediaType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        data: Buffer.from('PK\u0003\u0004broken'),
      }),
    ).rejects.toThrow('Не удалось прочитать');
    await expect(
      extractDocumentText({
        fileName: 'image.jpg',
        mediaType: 'image/jpeg',
        data: Buffer.from([255, 216, 255]),
      }),
    ).rejects.toThrow('пока нельзя');
  });
});
