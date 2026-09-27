import { describe, expect, it } from 'vitest';
import { createLogger, nullLogger, redacted, type LogLevel } from '../logger';

/** Captures what a logger wrote, so a test can read it back. */
function capture(level: LogLevel = 'debug'): {
  readonly lines: { level: LogLevel; line: string }[];
  readonly logger: ReturnType<typeof createLogger>;
} {
  const lines: { level: LogLevel; line: string }[] = [];
  const logger = createLogger({
    level,
    now: () => 1_700_000_000_000,
    sink: (severity, line) => lines.push({ level: severity, line }),
  });
  return { lines, logger };
}

/** Parses the captured JSON lines. */
function parsed(lines: readonly { line: string }[]): Record<string, unknown>[] {
  return lines.map((entry) => JSON.parse(entry.line) as Record<string, unknown>);
}

describe('createLogger', () => {
  it('writes one JSON object per event', () => {
    const { lines, logger } = capture();

    logger.info('request failed', { route: '/price', status: 500 });

    expect(lines).toHaveLength(1);
    expect(parsed(lines)[0]).toEqual({
      ts: 1_700_000_000_000,
      level: 'info',
      msg: 'request failed',
      route: '/price',
      status: 500,
    });
  });

  it('orders fields so two lines for one event diff cleanly', () => {
    const { lines, logger } = capture();

    logger.info('a', { z: 1, a: 2 });
    logger.info('b', { z: 1, a: 2 });

    expect(lines[0]?.line).toBe('{"ts":1700000000000,"level":"info","msg":"a","z":1,"a":2}');
    expect(lines[1]?.line).toBe('{"ts":1700000000000,"level":"info","msg":"b","z":1,"a":2}');
  });

  it('drops anything below its level', () => {
    const { lines, logger } = capture('warn');

    logger.debug('noise');
    logger.info('noise');
    logger.warn('kept');
    logger.error('kept');

    expect(lines.map((entry) => entry.level)).toEqual(['warn', 'error']);
  });

  it('routes each level to its own console method', () => {
    const seen: string[] = [];
    const logger = createLogger({
      sink: (level) => seen.push(level),
      level: 'debug',
    });

    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');

    expect(seen).toEqual(['debug', 'info', 'warn', 'error']);
  });

  it('stamps a child logger with its fields', () => {
    const { lines, logger } = capture();
    const child = logger.child({ requestId: 'req_1' });

    child.info('one');
    logger.info('two');

    expect(parsed(lines)[0]).toMatchObject({ msg: 'one', requestId: 'req_1' });
    expect(parsed(lines)[1]).not.toHaveProperty('requestId');
  });

  it('lets a child override a parent field', () => {
    const { lines, logger } = capture();

    logger.child({ a: 1 }).child({ a: 2 }).info('x');

    expect(parsed(lines)[0]).toMatchObject({ a: 2 });
  });

  it('defaults to info and to the console', () => {
    // Constructing without options must not throw and must not write anything.
    const logger = createLogger();
    logger.debug('dropped');
    logger.info('written');
  });
});

describe('nullLogger', () => {
  it('writes nothing and still answers child()', () => {
    expect(() => {
      nullLogger.debug('a');
      nullLogger.info('b');
      nullLogger.warn('c');
      nullLogger.error('d');
      nullLogger.child({ x: 1 }).info('e');
    }).not.toThrow();
  });
});

describe('redacted', () => {
  it('reports presence, never the value', () => {
    expect(redacted('correct horse battery staple')).toEqual({ present: true });
    expect(redacted(undefined)).toEqual({ present: false });
    expect(redacted('')).toEqual({ present: false });
    expect(redacted(null)).toEqual({ present: false });
  });

  it('never emits the secret it was given', () => {
    const { lines, logger } = capture();

    logger.info('register', { password: redacted('hunter2') });

    expect(lines[0]?.line).not.toContain('hunter2');
  });
});
