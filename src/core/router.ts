import { HttpError, fail } from './api.ts';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const OVERRIDABLE_METHODS: HttpMethod[] = ['GET', 'PUT', 'PATCH', 'DELETE'];

export interface Request {
  path: string;
  method: HttpMethod;
  params: Record<string, string>;
  body: Record<string, unknown>;
  pathParams?: Record<string, string>;
  context?: Record<string, unknown>;
  user?: Record<string, unknown> | null;
}

export interface Response {
  status: number;
  body: unknown;
}

export type Handler = (request: Request) => Response;
export type Middleware = (request: Request, next: () => Response) => Response;

type Segment = { type: 'static'; value: string } | { type: 'param'; name: string };

interface Route {
  method: HttpMethod;
  segments: Segment[];
  isStatic: boolean;
  handler: Handler;
  middleware: Middleware[];
}

export interface GroupRouter {
  get(path: string, handler: Handler, middleware?: Middleware[]): void;
  post(path: string, handler: Handler, middleware?: Middleware[]): void;
  put(path: string, handler: Handler, middleware?: Middleware[]): void;
  patch(path: string, handler: Handler, middleware?: Middleware[]): void;
  delete(path: string, handler: Handler, middleware?: Middleware[]): void;
  group(prefix: string, middleware: Middleware[], build: (group: GroupRouter) => void): void;
}

function normalize(path: string): string {
  if (path.length > 1 && path.endsWith('/')) {
    return path.slice(0, -1);
  }
  return path;
}

function splitSegments(path: string): string[] {
  const normalized = normalize(path);
  if (normalized === '/' || normalized === '') {
    return [];
  }
  return normalized.slice(1).split('/');
}

function parsePath(path: string): { segments: Segment[]; isStatic: boolean } {
  const parts = splitSegments(path);
  let isStatic = true;
  const segments: Segment[] = parts.map((part) => {
    if (part.startsWith(':')) {
      isStatic = false;
      return { type: 'param', name: part.slice(1) };
    }
    return { type: 'static', value: part };
  });
  return { segments, isStatic };
}

function joinPath(prefix: string, path: string): string {
  const left = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
  const right = path.startsWith('/') ? path : `/${path}`;
  const joined = `${left}${right}`;
  return joined === '' ? '/' : joined;
}

function matchStatic(segments: Segment[], pathSegments: string[]): boolean {
  if (segments.length !== pathSegments.length) {
    return false;
  }
  return segments.every((segment, index) => segment.type === 'static' && segment.value === pathSegments[index]);
}

function matchParams(segments: Segment[], pathSegments: string[]): Record<string, string> | null {
  if (segments.length !== pathSegments.length) {
    return null;
  }
  const params: Record<string, string> = {};
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const value = pathSegments[index];
    if (segment.type === 'static') {
      if (segment.value !== value) {
        return null;
      }
      continue;
    }
    if (value === '') {
      return null;
    }
    try {
      params[segment.name] = decodeURIComponent(value);
    } catch {
      return null;
    }
  }
  return params;
}

/**
 * Routes support a `:name` segment matched against one non-empty path
 * segment; static routes are tried first so a literal route always beats a
 * param route, independent of registration order.
 */
export class Router {
  private readonly routes: Route[] = [];

  get(path: string, handler: Handler, middleware: Middleware[] = []): void {
    this.register('GET', path, handler, middleware);
  }

  post(path: string, handler: Handler, middleware: Middleware[] = []): void {
    this.register('POST', path, handler, middleware);
  }

  put(path: string, handler: Handler, middleware: Middleware[] = []): void {
    this.register('PUT', path, handler, middleware);
  }

  patch(path: string, handler: Handler, middleware: Middleware[] = []): void {
    this.register('PATCH', path, handler, middleware);
  }

  delete(path: string, handler: Handler, middleware: Middleware[] = []): void {
    this.register('DELETE', path, handler, middleware);
  }

  group(prefix: string, middleware: Middleware[], build: (group: GroupRouter) => void): void {
    build(this.createGroup(prefix, middleware));
  }

  private createGroup(prefix: string, middleware: Middleware[]): GroupRouter {
    const register = (method: HttpMethod, path: string, handler: Handler, routeMiddleware: Middleware[]) =>
      this.register(method, joinPath(prefix, path), handler, [...middleware, ...routeMiddleware]);
    return {
      get: (path, handler, routeMiddleware = []) => register('GET', path, handler, routeMiddleware),
      post: (path, handler, routeMiddleware = []) => register('POST', path, handler, routeMiddleware),
      put: (path, handler, routeMiddleware = []) => register('PUT', path, handler, routeMiddleware),
      patch: (path, handler, routeMiddleware = []) => register('PATCH', path, handler, routeMiddleware),
      delete: (path, handler, routeMiddleware = []) => register('DELETE', path, handler, routeMiddleware),
      group: (nestedPrefix, nestedMiddleware, nestedBuild) =>
        nestedBuild(this.createGroup(joinPath(prefix, nestedPrefix), [...middleware, ...nestedMiddleware])),
    };
  }

  private register(method: HttpMethod, path: string, handler: Handler, middleware: Middleware[]): void {
    const { segments, isStatic } = parsePath(path);
    this.routes.push({ method, segments, isStatic, handler, middleware });
  }

  private findMatch(method: HttpMethod, pathSegments: string[]): { route: Route; params: Record<string, string> } | null {
    for (const route of this.routes) {
      if (route.method === method && route.isStatic && matchStatic(route.segments, pathSegments)) {
        return { route, params: {} };
      }
    }
    for (const route of this.routes) {
      if (route.method === method && !route.isStatic) {
        const params = matchParams(route.segments, pathSegments);
        if (params) {
          return { route, params };
        }
      }
    }
    return null;
  }

  private allowedMethods(pathSegments: string[]): HttpMethod[] {
    const allowed = new Set<HttpMethod>();
    for (const method of METHODS) {
      if (this.findMatch(method, pathSegments)) {
        allowed.add(method);
      }
    }
    return [...allowed].sort();
  }

  dispatch(request: Request): Response {
    try {
      return this.dispatchInner(request);
    } catch (error) {
      if (error instanceof HttpError) {
        return fail(error.status, error.code, error.message, error.details);
      }
      return fail(500, 'INTERNAL', 'Internal server error');
    }
  }

  private dispatchInner(request: Request): Response {
    let method = request.method;
    let body = request.body;

    if (method === 'POST' && typeof body._method === 'string') {
      const override = body._method.toUpperCase();
      if (!OVERRIDABLE_METHODS.includes(override as HttpMethod)) {
        throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
      }
      method = override as HttpMethod;
      const { _method, ...rest } = body;
      body = rest;
    }

    const pathSegments = splitSegments(request.path);
    const match = this.findMatch(method, pathSegments);
    if (!match) {
      const allowed = this.allowedMethods(pathSegments);
      if (allowed.length > 0) {
        throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed', { allowed });
      }
      throw new HttpError(404, 'NOT_FOUND', 'Not found');
    }

    const effectiveRequest: Request = { ...request, method, body, pathParams: match.params };
    const { route } = match;
    const run = (index: number): Response => {
      if (index >= route.middleware.length) {
        return route.handler(effectiveRequest);
      }
      return route.middleware[index](effectiveRequest, () => run(index + 1));
    };
    return run(0);
  }
}
