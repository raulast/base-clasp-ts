export type HttpMethod = 'GET' | 'POST';

export interface Request {
  path: string;
  method: HttpMethod;
  params: Record<string, string>;
  body: Record<string, unknown>;
  context?: Record<string, unknown>;
}

export interface Response {
  status: number;
  body: unknown;
}

export type Handler = (request: Request) => Response;
export type Middleware = (request: Request, next: () => Response) => Response;

interface Route {
  handler: Handler;
  middleware: Middleware[];
}

/**
 * Exact path+method matching only: GAS web apps don't expose real URL path
 * segments, they dispatch off a query param (e.g. e.parameter.action), so
 * there is no :param syntax to parse here.
 */
export class Router {
  private readonly routes = new Map<HttpMethod, Map<string, Route>>([
    ['GET', new Map()],
    ['POST', new Map()],
  ]);

  get(path: string, handler: Handler, middleware: Middleware[] = []): void {
    this.register('GET', path, handler, middleware);
  }

  post(path: string, handler: Handler, middleware: Middleware[] = []): void {
    this.register('POST', path, handler, middleware);
  }

  private register(method: HttpMethod, path: string, handler: Handler, middleware: Middleware[]): void {
    this.routes.get(method)!.set(path, { handler, middleware });
  }

  dispatch(request: Request): Response {
    const route = this.routes.get(request.method)?.get(request.path);
    if (!route) {
      return { status: 404, body: { error: `No route for ${request.method} ${request.path}` } };
    }
    const run = (index: number): Response => {
      if (index >= route.middleware.length) {
        return route.handler(request);
      }
      return route.middleware[index](request, () => run(index + 1));
    };
    return run(0);
  }
}
