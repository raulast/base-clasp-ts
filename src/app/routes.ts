import type { SheetAdapter } from '../core/sheet-adapter.ts';
import type { CryptoAdapter } from '../core/crypto-adapter.ts';
import type { LockAdapter } from '../core/lock-adapter.ts';
import { Router } from '../core/router.ts';
import { createAuthController } from './controllers/auth.controller.ts';
import { createPageController } from './controllers/page.controller.ts';
import { authMiddleware } from './middleware/auth.middleware.ts';

export interface RouterDeps {
  adapter: SheetAdapter;
  crypto: CryptoAdapter;
  getSecret: () => string;
  now?: () => Date;
  lock?: LockAdapter;
  // Views run inside a googleusercontent.com iframe, so links need the script's real URL.
  getAppUrl?: () => string;
}

export function createRouter({ adapter, crypto, getSecret, now, lock, getAppUrl = () => '' }: RouterDeps): Router {
  const router = new Router();

  const pages = createPageController({ getAppUrl });
  router.get('/', pages.index);
  router.get('/profile', pages.profile);

  const auth = createAuthController({ adapter, crypto, getSecret, now, lock });
  const requireAuth = [authMiddleware(getSecret(), crypto, now)];

  router.group('/api/v1', [], (group) => {
    group.post('/auth/login', auth.login);
    group.get('/auth/me', auth.me, requireAuth);
  });

  return router;
}
