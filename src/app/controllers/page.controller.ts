import type { Request, Response } from '../../core/router.ts';
import { view } from '../../core/view.ts';

export interface PageControllerDeps {
  getAppUrl: () => string;
}

export interface PageController {
  home: (request: Request) => Response;
  postDetail: (request: Request) => Response;
  login: () => Response;
  register: () => Response;
  profile: () => Response;
  dashboard: () => Response;
  postEditor: (request: Request) => Response;
  adminUsers: () => Response;
  adminTags: () => Response;
}

const APP_NAME = 'Gas Fullstack Core';

export function createPageController({ getAppUrl }: PageControllerDeps): PageController {
  // The browser cannot read the top window URL from the GAS iframe, so the server passes the query params.
  const home = (request: Request): Response =>
    view('app/views/home', {
      appName: APP_NAME,
      appUrl: getAppUrl(),
      tag: String(request.params.tag ?? ''),
      page: String(request.params.page ?? ''),
    });
  const postDetail = (request: Request): Response =>
    view('app/views/post', { appName: APP_NAME, appUrl: getAppUrl(), slug: request.pathParams?.slug ?? '' });
  const login = (): Response => view('app/views/login', { appName: APP_NAME, appUrl: getAppUrl() });
  const register = (): Response => view('app/views/register', { appName: APP_NAME, appUrl: getAppUrl() });
  const profile = (): Response => view('app/views/profile', { appName: APP_NAME, appUrl: getAppUrl() });
  const dashboard = (): Response => view('app/views/dashboard', { appName: APP_NAME, appUrl: getAppUrl() });
  const postEditor = (request: Request): Response =>
    view('app/views/post-editor', { appName: APP_NAME, appUrl: getAppUrl(), id: request.pathParams?.id ?? '' });
  const adminUsers = (): Response => view('app/views/admin-users', { appName: APP_NAME, appUrl: getAppUrl() });
  const adminTags = (): Response => view('app/views/admin-tags', { appName: APP_NAME, appUrl: getAppUrl() });
  return { home, postDetail, login, register, profile, dashboard, postEditor, adminUsers, adminTags };
}
