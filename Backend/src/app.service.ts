import { Injectable } from '@nestjs/common';

/**
 * The legacy file-polling game worker was intentionally removed. Feed ingestion
 * is owned by GameflowService and only accepts a host-authenticated, game-scoped
 * snapshot through POST /sendLoLInput.
 */
@Injectable()
export class AppService {
  getHello(): string {
    return 'Hello World!';
  }
}
