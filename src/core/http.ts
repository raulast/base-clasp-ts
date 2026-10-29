import type { HttpMethod, Request } from './router.ts';

interface GasEvent {
  parameter?: Record<string, string>;
  postData?: { contents?: string };
}

function parseJsonBody(contents: string | undefined): Record<string, unknown> {
  if (!contents) {
    return {};
  }
  try {
    const parsed = JSON.parse(contents);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

/**
 * GAS web app events carry no real URL path, so routes are selected via
 * e.parameter.route and the raw JSON body is best-effort parsed: a bad
 * payload degrades to an empty body instead of throwing.
 */
export function requestFromEvent(e: GasEvent, method: HttpMethod): Request {
  const params = e.parameter ?? {};
  return {
    path: params.route ?? '/',
    method,
    params,
    body: parseJsonBody(e.postData?.contents),
  };
}
