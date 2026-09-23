import { DataSource, EntityManager } from 'typeorm';
import JSZip from 'jszip';
import { ContentCenterService } from './content-center.service';
import { PreparationAiService } from './preparation-ai.service';
import { PlatformRole } from '../database/entities';

it('queues previously uploaded DOCX as text for DeepSeek without binary files', async () => {
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
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Сведения клиента</w:t></w:r></w:p></w:body></w:document>',
  );
  const bytes = await zip.generateAsync({ type: 'nodebuffer' });
  const manager = {
    query: jest.fn((sql: string, values?: unknown[]) => {
      void values;
      if (sql.includes('FROM cc_materials'))
        return Promise.resolve([
          {
            id: 'document-1',
            revision: 1,
            url_category: null,
            title: 'brief.docx',
            content: '',
            source_url: null,
            source_error: null,
            file_name: 'brief.docx',
            media_type:
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            file_data: bytes,
          },
        ]);
      if (sql.includes('INSERT INTO cc_preparation_runs'))
        return Promise.resolve([{ id: 'run-1', status: 'queued' }]);
      return Promise.resolve([]);
    }),
  };
  const db = {
    query: jest.fn(() =>
      Promise.resolve([
        {
          full_name: 'Администратор',
          role: null,
          site_ids: null,
          workspace_site_ids: [],
        },
      ]),
    ),
    transaction: (operation: (value: EntityManager) => Promise<unknown>) =>
      operation(manager as unknown as EntityManager),
  } as unknown as DataSource;
  const service = new ContentCenterService(
    db,
    new PreparationAiService({
      name: 'deepseek',
      supportsFiles: false,
      generate: jest.fn(),
    }),
  );

  await service.start(
    'workspace-1',
    { userId: 'admin-1', platformRole: PlatformRole.WISPO_ADMIN },
    { instruction: 'Сводка', withoutMaterials: false },
  );

  const call = manager.query.mock.calls.find(([sql]) =>
    sql.includes('INSERT INTO cc_preparation_runs'),
  );
  expect(call).toBeDefined();
  const input = JSON.parse(call![1][3] as string) as {
    materials: Array<{ content: string }>;
    files?: unknown;
  };
  expect(input.materials[0].content).toBe('Сведения клиента');
  expect(input.files).toBeUndefined();
});
