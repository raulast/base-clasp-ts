import type { SheetAdapter } from '../core/sheet-adapter.ts';
import type { CryptoAdapter } from '../core/crypto-adapter.ts';
import type { LockAdapter } from '../core/lock-adapter.ts';
import type { StorageAdapter } from '../core/storage-adapter.ts';
import { Router } from '../core/router.ts';
import { createAuthController } from './controllers/auth.controller.ts';
import { createPageController } from './controllers/page.controller.ts';
import { createPostsController } from './controllers/posts.controller.ts';
import { createTagsController } from './controllers/tags.controller.ts';
import { createCommentsController } from './controllers/comments.controller.ts';
import { createUsersController } from './controllers/users.controller.ts';
import { createMediaController } from './controllers/media.controller.ts';
import { syncPostMediaSharing, type MediaDeps } from './models/media.model.ts';
import { requireAuth, optionalAuth } from './middleware/auth.middleware.ts';

export interface RouterDeps {
  adapter: SheetAdapter;
  crypto: CryptoAdapter;
  getSecret: () => string;
  now?: () => Date;
  lock?: LockAdapter;
  // Views run inside a googleusercontent.com iframe, so links need the script's real URL.
  getAppUrl?: () => string;
  storage?: StorageAdapter;
  getMediaFolderId?: () => string;
}

export function createRouter({
  adapter,
  crypto,
  getSecret,
  now,
  lock,
  getAppUrl = () => '',
  storage,
  getMediaFolderId,
}: RouterDeps): Router {
  const router = new Router();

  const pages = createPageController({ getAppUrl });
  router.get('/', pages.home);
  router.get('/posts/:slug', pages.postDetail);
  router.get('/login', pages.login);
  router.get('/register', pages.register);
  router.get('/profile', pages.profile);

  const auth = createAuthController({ adapter, crypto, getSecret, now, lock });
  const mediaDeps: MediaDeps = { adapter, lock, now, storage: storage as StorageAdapter, getFolderId: getMediaFolderId ?? (() => '') };
  const media = createMediaController(mediaDeps);
  const posts = createPostsController({
    adapter,
    lock,
    now,
    onPostChanged: storage ? (post) => syncPostMediaSharing(mediaDeps, post) : undefined,
  });
  const tags = createTagsController({ adapter, lock, now });
  const comments = createCommentsController({ adapter, lock, now });
  const users = createUsersController({ adapter, lock, now });
  const mustAuth = [requireAuth({ adapter, crypto, getSecret, now })];
  const mayAuth = [optionalAuth({ adapter, crypto, getSecret, now })];

  router.group('/api/v1', [], (group) => {
    group.post('/auth/register', auth.register);
    group.post('/auth/login', auth.login);
    group.get('/auth/me', auth.me, mustAuth);

    group.get('/posts', posts.list, mayAuth);
    group.get('/posts/:idOrSlug', posts.show, mayAuth);
    group.post('/posts', posts.create, mustAuth);
    group.patch('/posts/:id', posts.update, mustAuth);
    group.delete('/posts/:id', posts.remove, mustAuth);

    group.get('/tags', tags.list);
    group.post('/tags', tags.create, mustAuth);

    group.get('/posts/:idOrSlug/comments', comments.list, mayAuth);
    group.post('/posts/:idOrSlug/comments', comments.create, mustAuth);
    group.delete('/comments/:id', comments.remove, mustAuth);

    group.get('/users', users.list, mustAuth);
    group.patch('/users/:id', users.update, mustAuth);

    group.get('/posts/:idOrSlug/media', media.list, mayAuth);
    group.post('/posts/:idOrSlug/media', media.upload, mustAuth);
    group.get('/media/:id', media.show, mayAuth);
    group.delete('/media/:id', media.remove, mustAuth);
  });

  return router;
}
