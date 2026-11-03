import type { Response } from '../../core/router.ts';
import { view } from '../../core/view.ts';

export interface PageControllerDeps {
  getAppUrl: () => string;
}

export interface PageController {
  index: () => Response;
  profile: () => Response;
}

const APP_NAME = 'Gas Fullstack Core';

export function createPageController({ getAppUrl }: PageControllerDeps): PageController {
  const index = (): Response => view('app/views/index', { appName: APP_NAME, appUrl: getAppUrl() });
  const profile = (): Response => view('app/views/profile', { appName: APP_NAME, appUrl: getAppUrl() });
  return { index, profile };
}
