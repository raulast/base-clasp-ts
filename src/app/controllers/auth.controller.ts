import type { Request, Response } from '../../core/router.ts';
import type { SheetAdapter } from '../../core/sheet-adapter.ts';
import type { CryptoAdapter } from '../../core/crypto-adapter.ts';
import { ok, unauthenticated } from '../../core/api.ts';
import { authenticate, findUserById, LOGIN_ERROR_MESSAGE } from '../models/user.model.ts';

export interface AuthControllerDeps {
  adapter: SheetAdapter;
  crypto: CryptoAdapter;
  getSecret: () => string;
  now?: () => Date;
}

export interface AuthController {
  login: (request: Request) => Response;
  me: (request: Request) => Response;
}

export function createAuthController({ adapter, crypto, getSecret, now }: AuthControllerDeps): AuthController {
  const login = (request: Request): Response => {
    const email = String(request.body.email ?? '');
    const password = String(request.body.password ?? '');
    const result = authenticate(adapter, crypto, getSecret(), email, password, now);
    if (!result.ok) {
      throw unauthenticated(LOGIN_ERROR_MESSAGE);
    }
    return ok({ token: result.token });
  };

  const me = (request: Request): Response => {
    const user = findUserById(adapter, request.context?.userId);
    if (!user) {
      throw unauthenticated('Unauthorized');
    }
    return ok(user);
  };

  return { login, me };
}
