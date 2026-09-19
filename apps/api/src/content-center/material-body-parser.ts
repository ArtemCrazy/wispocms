import type { NestExpressApplication } from '@nestjs/platform-express';
import { MATERIAL_FILE_LIMIT } from './material-file';

export function configureMaterialBodyParser(app: NestExpressApplication) {
  // Match the file-size envelope only for creating/updating source text.
  // Other JSON endpoints keep Express's default request-size protection.
  app.useBodyParser('json', {
    limit: MATERIAL_FILE_LIMIT,
    type: (request) =>
      ['POST', 'PUT'].includes(request.method ?? '') &&
      /^\/api\/workspaces\/[^/?]+\/content-center\/materials(?:\/[^/?]+)?\/?(?:\?|$)/.test(
        request.url ?? '',
      ) &&
      request.headers['content-type']?.split(';')[0].trim().toLowerCase() ===
        'application/json',
  });
  // Nest detects an existing jsonParser by name and would otherwise omit this.
  app.useBodyParser('json');
}
