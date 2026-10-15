import { Body, CanActivate, Controller, Delete, ExecutionContext, Get, HttpCode, Injectable, Param, Post, Put, Query, Req, StreamableFile, UnauthorizedException, UseGuards } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'crypto';
import { Request } from 'express';
import { ReplayService } from './replay.service';

@Injectable()
export class ReplayGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    context.switchToHttp().getResponse().setHeader('Cache-Control', 'no-store');
    const expected = process.env.REPLAY_ADMIN_TOKEN;
    const supplied = context.switchToHttp().getRequest<Request>().headers['x-replay-token'];
    if (!expected || !expected.trim() || typeof supplied !== 'string' || !supplied ||
      !timingSafeEqual(createHash('sha256').update(expected).digest(), createHash('sha256').update(supplied).digest())) throw new UnauthorizedException('Replay operator token required');
    return true;
  }
}
@Controller('replays')
@UseGuards(ReplayGuard)
export class ReplayController {
  constructor(private readonly pool: ReplayService) {}
  @Get() list(@Query('patch') patch?: string, @Query('sort') sort?: string) { return this.pool.list(patch, sort); }
  @Put(':matchId/file') @HttpCode(200)
  upload(@Param('matchId') id: string, @Req() req: Request) {
    return this.pool.upload(id, req.header('X-Replay-Version'), req, req.header('Content-Type'), req.header('Content-Length'));
  }
  @Get(':matchId/file') async download(@Param('matchId') id: string) {
    const { item, stream } = await this.pool.download(id);
    return new StreamableFile(stream, { type: 'application/octet-stream', length: item.sizeBytes, disposition: `attachment; filename="${item.matchId}.rofl"` });
  }
  @Post('reserve') reserve(@Body() body: unknown) { return this.pool.reserve(body); }
  @Post(':matchId/analyze') analyze(@Param('matchId') id: string) { return this.pool.analyze(id); }
  @Post(':matchId/release') release(@Param('matchId') id: string, @Body() body: unknown) { return this.pool.release(id, body); }
  @Delete(':matchId') remove(@Param('matchId') id: string) { return this.pool.remove(id); }
}
