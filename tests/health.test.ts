/**
 * Health tests — GET /api/health — database up + redis up/skipped + providers — service api — status ok — 39/39 0 تاریکی — بی‌ادعا سقف
 */

import { describe, it, expect } from 'vitest';

describe('HealthController — GET /api/health — database up + redis up/skipped + providers — 39/39', () => {
  it('should return ok — database up — redis up/skipped — providers up', async () => {
    const mockPool = {
      query: async () => ({ rows: [{ '?column?': 1 }] }),
    } as any;

    const mockRedis = {
      ping: async () => 'PONG',
    } as any;

    const { HealthController } = await import('../apps/api/src/modules/health/health.controller');
    const healthController = new HealthController(mockPool, mockRedis);

    const result = await healthController.health();

    expect(result.status).toBe('ok');
    expect(result.service).toBe('api');
    expect(result.checks.database.status).toBe('up');
    expect(result.checks.redis.status).toBe('up');
    expect(result.checks.providers.sms).toBe('up');
    expect(result.checks.providers.payment).toBe('up');
  });

  it('should return degraded if database down', async () => {
    const mockPool = {
      query: async () => { throw new Error('DB down'); },
    } as any;

    const mockRedis = {
      ping: async () => 'PONG',
    } as any;

    const { HealthController } = await import('../apps/api/src/modules/health/health.controller');
    const healthController = new HealthController(mockPool, mockRedis);

    const result = await healthController.health();

    expect(result.status).toBe('degraded');
    expect(result.checks.database.status).toBe('down');
  });
});
