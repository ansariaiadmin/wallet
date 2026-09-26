/** A route handler: receives a context, returns a result (maybe async). */
export type Handler<Ctx, Result> = (ctx: Ctx) => Result | Promise<Result>;

/** Raised when a route is dispatched before any handler was registered for it. */
export class UnknownRouteError extends Error {
  constructor(readonly route: string) {
    super(`No handler registered for route "${route}"`);
    this.name = 'UnknownRouteError';
  }
}

/** Minimal typed registry that maps route names to handlers. */
export class Router<Ctx = unknown> {
  private readonly handlers = new Map<string, Handler<Ctx, unknown>>();

  /** Registers `handler` under `route` and returns the router for chaining. */
  register<Result>(route: string, handler: Handler<Ctx, Result>): this {
    this.handlers.set(route, handler as Handler<Ctx, unknown>);
    return this;
  }

  /** True when a handler is registered for `route`. */
  has(route: string): boolean {
    return this.handlers.has(route);
  }

  /** All registered route names, in registration order. */
  routes(): string[] {
    return [...this.handlers.keys()];
  }

  /** Dispatches `route` with `ctx`, throwing {@link UnknownRouteError} if unknown. */
  async dispatch<Result>(route: string, ctx: Ctx): Promise<Result> {
    const handler = this.handlers.get(route);
    if (handler === undefined) {
      throw new UnknownRouteError(route);
    }
    return (await handler(ctx)) as Result;
  }
}
