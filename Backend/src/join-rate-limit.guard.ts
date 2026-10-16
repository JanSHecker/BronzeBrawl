import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';

/** Small, per-process limiter shared by code lookups and joins. Never trust a client-supplied forwarded IP. */
@Injectable()
export class JoinRateLimitGuard implements CanActivate {
  private readonly attempts = new Map<string, { count: number; resetAt: number }>();
  private readonly windowMs = 60_000;
  private readonly limit = 60;

  canActivate(context: ExecutionContext): boolean {
    const http = context.switchToHttp();
    const request = http.getRequest();
    const now = Date.now();
    for (const [key, entry] of this.attempts) {
      if (entry.resetAt <= now) this.attempts.delete(key);
    }
    const key = request.ip || request.socket?.remoteAddress || 'unknown';
    let entry = this.attempts.get(key);
    if (!entry && this.attempts.size < 10_000) {
      entry = { count: 0, resetAt: now + this.windowMs };
      this.attempts.set(key, entry);
    }
    if (!entry || entry.count >= this.limit) {
      http.getResponse().setHeader('Retry-After', String(Math.max(1, Math.ceil(((entry?.resetAt ?? now + this.windowMs) - now) / 1000))));
      throw new HttpException('Too many join attempts. Please wait a minute and try again.', HttpStatus.TOO_MANY_REQUESTS);
    }
    entry.count++;
    return true;
  }
}
