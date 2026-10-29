import { buildGreetingMessage } from './utils.ts';

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
