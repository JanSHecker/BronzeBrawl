import { Body, Controller, Get, Header, Headers, HttpException, HttpStatus, Post, Query } from '@nestjs/common';
import { GameflowService } from './gameflow.service';

@Controller('companion')
export class CompanionController {
  constructor(private readonly gameflow: GameflowService) {}

  @Post('connect')
  @Header('Cache-Control', 'no-store')
  connect(@Body() input: any, @Headers('x-game-token') token: string) {
    return this.gameflow.connectCompanion(input, token);
  }

  @Post('disconnect')
  @Header('Cache-Control', 'no-store')
  disconnect(@Body() input: any, @Headers('x-game-token') token: string) {
    return this.gameflow.disconnectCompanion(input, token);
  }

  @Post('heartbeat')
  @Header('Cache-Control', 'no-store')
  heartbeat(@Body() input: any, @Headers('x-companion-token') token: string) {
    return this.gameflow.companionHeartbeat(input, token);
  }

  @Post('input')
  @Header('Cache-Control', 'no-store')
  input(@Body() input: any, @Headers('x-companion-token') token: string) {
    return this.gameflow.ingestCompanion(input, token);
  }

  @Get('status')
  @Header('Cache-Control', 'no-store')
  status(@Query('gameId') value: string, @Headers('x-game-token') token: string) {
    if (!/^[1-9]\d*$/.test(value || '') || !Number.isSafeInteger(Number(value))) {
      throw new HttpException('invalid gameId', HttpStatus.BAD_REQUEST);
    }
    return this.gameflow.companionStatus(Number(value), token);
  }
}
