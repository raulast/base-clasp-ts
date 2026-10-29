import type { SheetAdapter } from '../core/sheet-adapter.ts';
import type { CryptoAdapter } from '../core/crypto-adapter.ts';
import type { Request } from '../core/router.ts';
import { Router } from '../core/router.ts';
import { view } from '../core/view.ts';
import { login, findUserById, LOGIN_ERROR_MESSAGE } from './controllers/auth.controller.ts';
import { authMiddleware } from './middleware/auth.middleware.ts';

export interface RouterDeps {
  adapter: SheetAdapter;
  crypto: CryptoAdapter;
  getSecret: () => string;
  now?: () => Date;
  // Views run inside a googleusercontent.com iframe, so links need the script's real URL.
  getAppUrl?: () => string;
}

const APP_NAME = 'Gas Fullstack Core';

export function createRouter({
  adapter,
  crypto,
  getSecret,
  now = () => new Date(),
  getAppUrl = () => '',
}: RouterDeps): Router {
  const router = new Router();
  const page = (name: string) => () => view(name, { appName: APP_NAME, appUrl: getAppUrl() });

  router.get('/', page('app/views/index'));
  router.get('/profile', page('app/views/profile'));

  router.post('/login', (request) => {
    const email = String(request.body.email ?? '');
    const password = String(request.body.password ?? '');
    const result = login(adapter, crypto, getSecret(), email, password, now);
    if (!result.ok) {
      return { status: 401, body: { error: LOGIN_ERROR_MESSAGE } };
    }
    return { status: 200, body: { token: result.token } };
  });

  const me = (request: Request) => {
    const user = findUserById(adapter, request.context?.userId);
    if (!user) {
      return { status: 401, body: { error: 'Unauthorized' } };
    }
    return { status: 200, body: user };
  };
  const requireAuth = [authMiddleware(getSecret(), crypto, now)];
  router.post('/me', me, requireAuth);

  return router;
}
