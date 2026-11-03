import type { Middleware, Request } from '../../core/router.ts';
import type { SheetAdapter } from '../../core/sheet-adapter.ts';
import type { CryptoAdapter } from '../../core/crypto-adapter.ts';
import { verifyJwt } from '../../core/auth.ts';
import { unauthenticated } from '../../core/api.ts';
import type { CellValue } from '../../core/sheet-adapter.ts';
import { usersModel, sanitizeUser, isDisabled } from '../models/user.model.ts';

export interface AuthMiddlewareDeps {
  adapter: SheetAdapter;
  crypto: CryptoAdapter;
  getSecret: () => string;
  now?: () => Date;
}

function resolveUser(token: string, deps: AuthMiddlewareDeps): Record<string, unknown> {
  const result = verifyJwt(token, deps.getSecret(), deps.crypto, deps.now);
  if (!result.valid) {
    throw unauthenticated('Unauthorized');
  }
  const model = usersModel(deps.adapter, deps.now);
  const user = model.find(result.payload.sub as CellValue);
  if (!user || isDisabled(user.disabled)) {
    throw unauthenticated('Unauthorized');
  }
  return sanitizeUser(user);
}

// A missing or null token means "no token"; anything else must be a non-empty string or it is rejected,
// so hostile bodies (numbers, arrays, objects) get a 401 instead of crashing the JWT parser.
function tokenFrom(request: Request): string | undefined {
  const token = request.body.token;
  if (token === undefined || token === null) {
    return undefined;
  }
  if (typeof token !== 'string' || token.length === 0) {
    throw unauthenticated('Unauthorized');
  }
  return token;
}

export function optionalAuth(deps: AuthMiddlewareDeps): Middleware {
  return (request, next) => {
    const token = tokenFrom(request);
    request.user = token === undefined ? null : resolveUser(token, deps);
    return next();
  };
}

export function requireAuth(deps: AuthMiddlewareDeps): Middleware {
  return (request, next) => {
    const token = tokenFrom(request);
    if (!token) {
      throw unauthenticated('Unauthorized');
    }
    request.user = resolveUser(token, deps);
    return next();
  };
}
