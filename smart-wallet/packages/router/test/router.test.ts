import { describe, expect, it } from 'vitest';
import { Router, UnknownRouteError } from '@router/router';

interface Ctx {
  readonly value: number;
}

describe('Router', () => {
  it('dispatches to the registered handler', async () => {
    const router = new Router<Ctx>();
    router.register('double', ({ value }) => value * 2);

    await expect(router.dispatch('double', { value: 21 })).resolves.toBe(42);
  });

  it('awaits async handlers', async () => {
    const router = new Router<Ctx>();
    router.register('async', async ({ value }) => value + 1);

    await expect(router.dispatch('async', { value: 41 })).resolves.toBe(42);
  });

  it('rejects unknown routes', async () => {
    const router = new Router();

    await expect(router.dispatch('missing', undefined)).rejects.toThrow(UnknownRouteError);
  });

  it('reports and lists registered routes', () => {
    const router = new Router<Ctx>();
    router.register('a', () => 1).register('b', () => 2);

    expect(router.has('a')).toBe(true);
    expect(router.has('c')).toBe(false);
    expect(router.routes()).toEqual(['a', 'b']);
  });
});
