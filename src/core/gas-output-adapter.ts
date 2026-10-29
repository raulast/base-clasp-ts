import type { OutputAdapter } from './output-adapter.ts';

export class GasOutputAdapter implements OutputAdapter {
  renderView(name: string, data: Record<string, unknown>): GoogleAppsScript.HTML.HtmlOutput {
    const template = HtmlService.createTemplateFromFile(name) as unknown as Record<string, unknown> & {
      evaluate(): GoogleAppsScript.HTML.HtmlOutput;
    };
    for (const [key, value] of Object.entries(data)) {
      template[key] = value;
    }
    // HtmlService drops <meta name="viewport"> written in the template; it must be set on the output.
    return template.evaluate().addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }

  json(data: unknown): GoogleAppsScript.Content.TextOutput {
    return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
  }
}

// Partials are evaluated as templates so their scriptlets (e.g. <?= appName ?>) render.
export function includeHtml(name: string, data: Record<string, unknown> = {}): string {
  const template = HtmlService.createTemplateFromFile(name) as unknown as Record<string, unknown> & {
    evaluate(): GoogleAppsScript.HTML.HtmlOutput;
  };
  for (const [key, value] of Object.entries(data)) {
    template[key] = value;
  }
  return template.evaluate().getContent();
}
