/**
 * Genera un saludo personalizado con la fecha actual.
 */
export function buildGreetingMessage(name: string): string {
  const currentDate = new Date().toLocaleDateString('es-ES');
  return `¡Hola, ${name}! Bienvenido a tu script de automatización. Hoy es ${currentDate}.`;
}
