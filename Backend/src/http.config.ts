import { NestExpressApplication } from '@nestjs/platform-express';

// Full Liveclient snapshots include a growing event history. Keep this bounded
// and aligned with client_max_body_size in both deployment/nginx examples.
export const JSON_BODY_LIMIT = 4 * 1024 * 1024;

export function configureHttpBodyParser(app: NestExpressApplication): void {
  // Register before init/listen so Nest does not install its 100 KiB default.
  app.useBodyParser('json', { limit: JSON_BODY_LIMIT });
}
