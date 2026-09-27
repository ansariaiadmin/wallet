/**
 * Structured logging.
 *
 * One line of JSON per event, so a log shipper can index it without a parser
 * per deployment. No dependency: the shape is four fields and a sink, and a
 * logging library would be the heaviest thing in this package for the least
 * behaviour.
 *
 * The rule that matters: **never pass a secret**. The logger has no notion of
 * one, so it is the caller's job — `password`, `token`, `mnemonic`, `signedTx`
 * and `privateKey` are logged as a presence flag and nothing else. The fields
 * below are deliberately the ones that are safe by construction: ids, counts,
 * durations, status codes and error codes.
 */

/** Severity, ordered. A logger drops anything below its level. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Fields a log line may carry. Values must be JSON-safe. */
export type LogFields = Readonly<Record<string, unknown>>;

/** What a logger does with a finished line. */
export interface LogSink {
  (level: LogLevel, line: string): void;
}

/** The logger surface the API depends on. */
export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  /** A child logger that stamps the same fields onto every line it writes. */
  child(fields: LogFields): Logger;
}

/** Default sink: one JSON object per line on the matching console method. */
export const consoleSink: LogSink = (level, line) => {
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
};

/** A logger that drops everything, for tests that must stay quiet. */
export const nullLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => nullLogger,
};

/** Builds a logger. */
export function createLogger(
  options: {
    readonly level?: LogLevel;
    readonly sink?: LogSink;
    readonly base?: LogFields;
    /** Injected so a test can pin the timestamp. Defaults to `Date.now`. */
    readonly now?: () => number;
  } = {},
): Logger {
  const level = options.level ?? 'info';
  const sink = options.sink ?? consoleSink;
  const base = options.base ?? {};
  const now = options.now ?? Date.now;

  const write = (severity: LogLevel, message: string, fields: LogFields | undefined): void => {
    if (LEVEL_ORDER[severity] < LEVEL_ORDER[level]) {
      return;
    }
    // Field order is stable so two lines for the same event diff cleanly.
    sink(
      severity,
      JSON.stringify({ ts: now(), level: severity, msg: message, ...base, ...fields }),
    );
  };

  return {
    debug: (message, fields) => write('debug', message, fields),
    info: (message, fields) => write('info', message, fields),
    warn: (message, fields) => write('warn', message, fields),
    error: (message, fields) => write('error', message, fields),
    child: (fields) => createLogger({ level, sink, base: { ...base, ...fields }, now }),
  };
}

/**
 * Renders a value as a field that cannot leak it.
 *
 * Anything that might be a secret is reduced to whether it was present, which
 * is what an operator needs and all a caller should ever see.
 */
export function redacted(value: unknown): LogFields {
  return value === undefined || value === null || value === ''
    ? { present: false }
    : { present: true };
}
