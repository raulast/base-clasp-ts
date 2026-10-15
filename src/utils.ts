/**
 * Genera un saludo personalizado con la fecha actual.
 * Al no usar 'export', se mantiene en el entorno global de Apps Script.
 */
function buildGreetingMessage(name: string): string {
  const currentDate = new Date().toLocaleDateString('es-ES');
  return `¡Hola, ${name}! Bienvenido a tu script de automatización. Hoy es ${currentDate}.`;
}