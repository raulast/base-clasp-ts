import type { OutputAdapter } from './output-adapter.ts';

export class GasOutputAdapter implements OutputAdapter {
  renderView(name: string, data: Record<string, unknown>): GoogleAppsScript.HTML.HtmlOutput {
    const template = HtmlService.createTemplateFromFile(name) as unknown as Record<string, unknown> & {
      evaluate(): GoogleAppsScript.HTML.HtmlOutput;
    };
    for (const [key, value] of Object.entries(data)) {
      template[key] = value;
    }
    return template.evaluate();
  }

  json(data: unknown): GoogleAppsScript.Content.TextOutput {
    return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
  }
}

export function includeHtml(name: string): string {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}
