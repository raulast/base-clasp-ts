import type { Response } from './router.ts';
import type { OutputAdapter } from './output-adapter.ts';

interface ViewResult {
  kind: 'view';
  name: string;
  data: Record<string, unknown>;
}

interface JsonResult {
  kind: 'json';
  data: unknown;
}

export function view(name: string, data: Record<string, unknown> = {}): Response {
  const body: ViewResult = { kind: 'view', name, data };
  return { status: 200, body };
}

export function json(data: unknown): Response {
  const body: JsonResult = { kind: 'json', data };
  return { status: 200, body };
}

export function isViewResult(body: unknown): body is ViewResult {
  return typeof body === 'object' && body !== null && (body as { kind?: unknown }).kind === 'view';
}

export function isJsonResult(body: unknown): body is JsonResult {
  return typeof body === 'object' && body !== null && (body as { kind?: unknown }).kind === 'json';
}

/**
 * GAS web apps can't set HTTP status codes, so `response.status` never
 * reaches the adapter — it's internal bookkeeping only.
 */
export function toGasOutput(response: Response, output: OutputAdapter): unknown {
  const { body } = response;
  if (isViewResult(body)) {
    return output.renderView(body.name, body.data);
  }
  if (isJsonResult(body)) {
    return output.json(body.data);
  }
  return output.json(body);
}
