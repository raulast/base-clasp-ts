import { buildGreetingMessage } from './utils.ts';
import { requestFromEvent } from './core/http.ts';
import { toGasOutput } from './core/view.ts';
import { MigrationRunner } from './core/migration.ts';
import { GasSheetAdapter } from './core/gas-sheet-adapter.ts';
import { GasCryptoAdapter, getScriptSecret } from './core/gas-crypto-adapter.ts';
import { GasOutputAdapter, includeHtml } from './core/gas-output-adapter.ts';
import { GasLockAdapter } from './core/gas-lock-adapter.ts';
import { GasStorageAdapter } from './core/gas-storage-adapter.ts';
import { createRouter } from './app/routes.ts';
import { createUser as createUserWithAdapter } from './app/models/user.model.ts';
import { migrations } from './app/migrations/index.ts';
import { isAdmin } from './app/admin.ts';
import { runSeeders } from './core/seeder.ts';
import { seeders } from './app/seeders/index.ts';

const adapter = new GasSheetAdapter();
const crypto = new GasCryptoAdapter();
const lock = new GasLockAdapter();
const storage = new GasStorageAdapter();

function router() {
  return createRouter({
    adapter,
    crypto,
    getSecret: () => getScriptSecret('JWT_SECRET'),
    getAppUrl: () => ScriptApp.getService().getUrl() ?? '',
    lock,
    storage,
    getMediaFolderId: () => getScriptSecret('MEDIA_FOLDER_ID'),
  });
}

function assertAdmin(): void {
  const email = Session.getActiveUser().getEmail();
  const adminEmails = getScriptSecret('ADMIN_EMAILS');
  if (!isAdmin(email, adminEmails)) {
    throw new Error('Forbidden');
  }
}

export function doGet(e: GoogleAppsScript.Events.DoGet): GoogleAppsScript.HTML.HtmlOutput | GoogleAppsScript.Content.TextOutput {
  const request = requestFromEvent(e, 'GET');
  const response = router().dispatch(request);
  return toGasOutput(response, new GasOutputAdapter()) as
    | GoogleAppsScript.HTML.HtmlOutput
    | GoogleAppsScript.Content.TextOutput;
}

export function doPost(e: GoogleAppsScript.Events.DoPost): GoogleAppsScript.HTML.HtmlOutput | GoogleAppsScript.Content.TextOutput {
  const request = requestFromEvent(e, 'POST');
  const response = router().dispatch(request);
  return toGasOutput(response, new GasOutputAdapter()) as
    | GoogleAppsScript.HTML.HtmlOutput
    | GoogleAppsScript.Content.TextOutput;
}

export function api(path: string, body: Record<string, unknown> = {}): unknown {
  const response = router().dispatch({ path, method: 'POST', params: {}, body });
  return response.body;
}

export function include(name: string, data: Record<string, unknown> = {}): string {
  return includeHtml(name, data);
}

export function migrate(): string[] {
  assertAdmin();
  const runner = new MigrationRunner(migrations, adapter);
  return runner.migrate();
}

export function createUser(email: string, password: string, username: string, role: string): unknown {
  assertAdmin();
  return createUserWithAdapter(adapter, crypto, email, password, username, role, () => new Date(), lock);
}

export function seed(): unknown {
  assertAdmin();
  return runSeeders(seeders, { adapter, lock, now: () => new Date() });
}

/**
 * Función principal ejecutable desde el editor de Google Apps Script o disparadores.
 */
export function main(): void {
  // Puedes usar variables y APIs de Google gracias a @types/google-apps-script
  const activeSpreadsheet = SpreadsheetApp.getActiveSpreadsheet();

  const statusMessage = buildGreetingMessage('Usuario');

  // Mostramos el resultado en los logs de la consola de Google
  Logger.log(statusMessage);

  // Ejemplo opcional: Mostrar una alerta flotante en la hoja de cálculo actual
  if (activeSpreadsheet) {
    activeSpreadsheet.toast(statusMessage, 'Estado del Script');
  }
}
