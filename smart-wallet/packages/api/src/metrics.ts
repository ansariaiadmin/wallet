/**
 * Request counters, exposed at `GET /api/v1/metrics`.
 *
 * A registry is a value, not a module: two apps in one process keep separate
 * counters, which is the same rule the tx store and the cache stores follow.
 * The text output is Prometheus' exposition format, because that is what a
 * scraper expects and it costs nothing to produce.
 */

/** One bucket boundary in milliseconds. */
export const LATENCY_BUCKETS_MS: readonly number[] = [5, 10, 25, 50, 100, 250, 500, 1000, 5000];

/** What the registry counts for one route. */
export interface RouteCounters {
  requests: number;
  errors: number;
  /** Sum of every observed duration, for a mean. */
  totalMs: number;
  /** Count per {@link LATENCY_BUCKETS_MS} boundary, plus an overflow bucket. */
  buckets: number[];
  /** How the last status code was distributed, keyed by code. */
  statuses: Map<number, number>;
}

/** A blank counter set. */
function blankCounters(): RouteCounters {
  return {
    requests: 0,
    errors: 0,
    totalMs: 0,
    buckets: new Array<number>(LATENCY_BUCKETS_MS.length + 1).fill(0),
    statuses: new Map<number, number>(),
  };
}

/** Counts what the API did, per route and in total. */
export class MetricsRegistry {
  private readonly routes = new Map<string, RouteCounters>();
  private readonly startedAt: number;
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
    this.startedAt = now();
  }

  /** Records one finished request. */
  record(route: string, status: number, durationMs: number): void {
    const counters = this.routes.get(route) ?? blankCounters();
    counters.requests += 1;
    counters.totalMs += durationMs;
    if (status >= 400) {
      counters.errors += 1;
    }
    const bucket = LATENCY_BUCKETS_MS.findIndex((boundary) => durationMs <= boundary);
    const index = bucket === -1 ? LATENCY_BUCKETS_MS.length : bucket;
    const slot = counters.buckets[index];
    counters.buckets[index] = (slot ?? 0) + 1;
    counters.statuses.set(status, (counters.statuses.get(status) ?? 0) + 1);
    this.routes.set(route, counters);
  }

  /** Seconds since this registry was built. */
  uptimeSeconds(): number {
    return Math.max(0, (this.now() - this.startedAt) / 1000);
  }

  /** Every route's counters, in the order they were first seen. */
  snapshot(): ReadonlyMap<string, RouteCounters> {
    return this.routes;
  }

  /** Totals across every route. */
  totals(): { requests: number; errors: number } {
    let requests = 0;
    let errors = 0;
    for (const counters of this.routes.values()) {
      requests += counters.requests;
      errors += counters.errors;
    }
    return { requests, errors };
  }

  /**
   * Prometheus exposition text.
   *
   * Labels are quoted and escaped, because a route path can contain a quote
   * only through a request that never reaches here — but the rule is cheap and
   * the output stays parseable either way.
   */
  toPrometheus(): string {
    const lines: string[] = [];
    const escape = (value: string): string => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

    lines.push('# HELP wallet_http_requests_total Requests handled, per route.');
    lines.push('# TYPE wallet_http_requests_total counter');
    for (const [route, counters] of this.routes) {
      lines.push(`wallet_http_requests_total{route="${escape(route)}"} ${counters.requests}`);
    }

    lines.push('# HELP wallet_http_errors_total Requests answered 4xx or 5xx, per route.');
    lines.push('# TYPE wallet_http_errors_total counter');
    for (const [route, counters] of this.routes) {
      lines.push(`wallet_http_errors_total{route="${escape(route)}"} ${counters.errors}`);
    }

    lines.push('# HELP wallet_http_duration_ms_sum Total observed duration, per route.');
    lines.push('# TYPE wallet_http_duration_ms_sum counter');
    for (const [route, counters] of this.routes) {
      lines.push(`wallet_http_duration_ms_sum{route="${escape(route)}"} ${counters.totalMs}`);
    }

    lines.push('# HELP wallet_http_duration_ms_bucket Requests per latency bucket.');
    lines.push('# TYPE wallet_http_duration_ms_bucket histogram');
    for (const [route, counters] of this.routes) {
      for (const [index, count] of counters.buckets.entries()) {
        const boundary =
          index < LATENCY_BUCKETS_MS.length ? String(LATENCY_BUCKETS_MS[index]) : '+Inf';
        lines.push(
          `wallet_http_duration_ms_bucket{route="${escape(route)}",le="${boundary}"} ${count ?? 0}`,
        );
      }
    }

    lines.push('# HELP wallet_uptime_seconds Seconds since the app was built.');
    lines.push('# TYPE wallet_uptime_seconds gauge');
    lines.push(`wallet_uptime_seconds ${this.uptimeSeconds().toFixed(3)}`);

    return `${lines.join('\n')}\n`;
  }
}
