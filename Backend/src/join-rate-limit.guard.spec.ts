import { JoinRateLimitGuard } from './join-rate-limit.guard';

test('limits by connection address, ignores forwarded headers and resets after a minute', () => {
  jest.useFakeTimers();
  try {
    const guard = new JoinRateLimitGuard();
    const response = { setHeader: jest.fn() };
    const request = { ip: '127.0.0.1', headers: { 'x-forwarded-for': 'one' } };
    const context: any = { switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }) };
    for (let count = 0; count < 60; count++) expect(guard.canActivate(context)).toBe(true);
    request.headers['x-forwarded-for'] = 'two';
    expect(() => guard.canActivate(context)).toThrow('Too many join attempts');
    expect(response.setHeader).toHaveBeenCalledWith('Retry-After', '60');
    request.ip = '127.0.0.2';
    expect(guard.canActivate(context)).toBe(true);
    request.ip = '127.0.0.1';
    jest.advanceTimersByTime(60_000);
    expect(guard.canActivate(context)).toBe(true);
  } finally { jest.useRealTimers(); }
});
