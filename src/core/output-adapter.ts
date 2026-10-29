/**
 * Rendering backend view.ts delegates to, kept separate so Node tests can
 * stub it and the GAS implementation can use HtmlService/ContentService.
 */
export interface OutputAdapter {
  renderView(name: string, data: Record<string, unknown>): unknown;
  json(data: unknown): unknown;
}
