import type { Request, Response } from '../../core/router.ts';
import { view } from '../../core/view.ts';

export interface PageControllerDeps {
  getAppUrl: () => string;
}

export interface PageController {
  home: () => Response;
  postDetail: (request: Request) => Response;
  login: () => Response;
  register: () => Response;
  profile: () => Response;
}

const APP_NAME = 'Gas Fullstack Core';

export function createPageController({ getAppUrl }: PageControllerDeps): PageController {
  const home = (): Response => view('app/views/home', { appName: APP_NAME, appUrl: getAppUrl() });
  const postDetail = (request: Request): Response =>
    view('app/views/post', { appName: APP_NAME, appUrl: getAppUrl(), slug: request.pathParams?.slug ?? '' });
  const login = (): Response => view('app/views/login', { appName: APP_NAME, appUrl: getAppUrl() });
  const register = (): Response => view('app/views/register', { appName: APP_NAME, appUrl: getAppUrl() });
  const profile = (): Response => view('app/views/profile', { appName: APP_NAME, appUrl: getAppUrl() });
  return { home, postDetail, login, register, profile };
}
