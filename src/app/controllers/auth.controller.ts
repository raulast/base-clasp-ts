import type { Request, Response } from '../../core/router.ts';
import type { SheetAdapter } from '../../core/sheet-adapter.ts';
import type { CryptoAdapter } from '../../core/crypto-adapter.ts';
import type { LockAdapter } from '../../core/lock-adapter.ts';
import { ok, created, unauthenticated } from '../../core/api.ts';
import { authenticate, createUser, LOGIN_ERROR_MESSAGE } from '../models/user.model.ts';

export interface AuthControllerDeps {
  adapter: SheetAdapter;
  crypto: CryptoAdapter;
  getSecret: () => string;
  now?: () => Date;
  lock?: LockAdapter;
}

export interface AuthController {
  register: (request: Request) => Response;
  login: (request: Request) => Response;
  me: (request: Request) => Response;
}

export function createAuthController({ adapter, crypto, getSecret, now, lock }: AuthControllerDeps): AuthController {
  const register = (request: Request): Response => {
    const email = String(request.body.email ?? '');
    const password = String(request.body.password ?? '');
    const username = String(request.body.username ?? '');
    const user = createUser(adapter, crypto, email, password, username, 'reader', now, lock);
    const result = authenticate(adapter, crypto, getSecret(), email, password, now);
    return created({ token: result.token, user });
  };

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
    if (!request.user) {
      throw unauthenticated('Unauthorized');
    }
    return ok(request.user);
  };

  return { register, login, me };
}
