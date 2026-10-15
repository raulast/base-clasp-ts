# base-clasp-ts

Base para desarrollar automatizaciones de **Google Apps Script** (Google Sheets, Docs, Drive, etc.) usando **TypeScript** y **clasp**.

## Requisitos previos

- [Node.js](https://nodejs.org/)
- [pnpm](https://pnpm.io/) instalado globalmente:

  ```bash
  npm install -g pnpm
  ```

- [clasp](https://github.com/google/clasp) instalado globalmente:

  ```bash
  pnpm add -g @google/clasp
  ```

- Cuenta de Google con la [API de Apps Script habilitada](https://script.google.com/home/usersettings) (activar "Google Apps Script API" en esa página).
- Login con clasp (una sola vez por máquina):

  ```bash
  clasp login
  ```

## Cómo conseguir el Script ID

El `scriptId` identifica el proyecto de Apps Script al que vas a enviar (push) o traer (pull) el código. Según la [documentación oficial de clasp](https://github.com/google/clasp), hay dos formas de obtenerlo:

### Opción A — Crear un proyecto nuevo con clasp

```bash
clasp create --title "Nombre del proyecto" --type sheets
```

Esto crea un Google Sheet nuevo con su Apps Script vinculado y genera un `.clasp.json` con el `scriptId` ya configurado. Copiá ese `scriptId` a tu `.env` (ver más abajo) y podés borrar el `.clasp.json` generado, porque este proyecto lo regenera automáticamente desde `.env`.

### Opción B — Usar un Google Sheet ya existente

1. Abrí el Google Sheet.
2. Ir a **Extensiones → Apps Script**.
3. En el editor de Apps Script, ir a **Configuración del proyecto** (ícono de engranaje).
4. Copiar el valor de **"ID del proyecto de secuencia de comandos"** (Script ID).

También podés sacarlo directo de la URL del editor de Apps Script:

```
https://script.google.com/home/projects/<SCRIPT_ID>/edit
```

## Configuración del proyecto

1. Instalar dependencias:

   ```bash
   pnpm install
   ```

2. Crear tu archivo `.env` a partir del ejemplo:

   ```bash
   cp .env.example .env
   ```

3. Pegar tu `scriptId` en `.env`:

   ```
   CLASP_SCRIPT_ID=tu_script_id_aqui
   ```

   El `.clasp.json` del repo se genera automáticamente a partir de esta variable (ver `setup-clasp.ts`), así que no lo edites a mano.

## Estructura del proyecto

```
src/
  appsscript.json   # Manifest de Apps Script (timezone, servicios habilitados, runtime)
  index.ts          # Punto de entrada (función main)
  utils.ts          # Funciones utilitarias compartidas
dist/               # Salida compilada (generada por tsc, no se versiona)
setup-clasp.ts      # Genera .clasp.json a partir de CLASP_SCRIPT_ID
```

En Apps Script todas las funciones top-level de todos los archivos comparten el mismo ámbito global (no hay módulos ES), por eso `index.ts` puede llamar a `buildGreetingMessage` de `utils.ts` sin importarla explícitamente.

## Cómo usar el proyecto

| Comando | Qué hace |
|---|---|
| `pnpm build` | Compila `src/*.ts` a `dist/` y copia `appsscript.json` |
| `pnpm build:clean` | Limpia `dist/` y vuelve a compilar |
| `pnpm push` | Regenera `.clasp.json` y sube el código actual de `dist/` al proyecto de Apps Script |
| `pnpm deploy` | Build limpio + push, en un solo paso (flujo recomendado) |
| `pnpm pull` | Trae el código desde Apps Script hacia `dist/` |
| `pnpm open` | Abre el proyecto en el editor web de Apps Script |

### Flujo de trabajo típico

1. Escribir o modificar código en `src/*.ts`.
2. Ejecutar `pnpm deploy` para compilar y subir los cambios.
3. Verificar la ejecución desde el editor de Apps Script (`pnpm open`) o directamente en el Google Sheet vinculado.

### Agregar servicios avanzados (Sheets, Drive, etc.)

Si necesitás otro servicio avanzado, agregalo en `src/appsscript.json` dentro de `dependencies.enabledAdvancedServices`, por ejemplo:

```json
{
  "userSymbol": "Drive",
  "version": "v3",
  "serviceId": "drive"
}
```

Volvé a correr `pnpm deploy` para que el cambio se refleje en el proyecto de Apps Script.

## Triggers (disparadores)

Apps Script ofrece dos tipos de triggers para automatizar la ejecución de funciones:

### Triggers simples

Se detectan automáticamente por el nombre de la función, sin configuración adicional. Solo hay que declararlas en algún `.ts` de `src/`:

```typescript
function onOpen(): void {
  // Se ejecuta cada vez que se abre el Google Sheet
  SpreadsheetApp.getUi().createMenu("Mi Menú").addItem("Ejecutar", "main").addToUi();
}

function onEdit(e: GoogleAppsScript.Events.SheetsOnEdit): void {
  // Se ejecuta cada vez que se edita una celda
  Logger.log(`Celda editada: ${e.range.getA1Notation()}`);
}
```

Limitación: los triggers simples no pueden acceder a servicios que requieran autorización de terceros (por ejemplo, enviar correos) ni ejecutarse si el editor no es el propietario de la hoja.

### Triggers instalables (time-driven, on form submit, etc.)

Para disparadores programados (por tiempo) o que necesitan permisos ampliados, hay que crearlos manualmente, ya sea desde el editor de Apps Script (**Triggers → Add Trigger**) o por código con `ScriptApp`:

```typescript
function crearTriggerDiario(): void {
  ScriptApp.newTrigger("main")
    .timeBased()
    .everyDays(1)
    .atHour(6)
    .create();
}
```

Ejecutá `crearTriggerDiario` una sola vez manualmente desde el editor de Apps Script (`pnpm open`) para registrar el trigger; después de eso, `main` correrá sola todos los días a la hora indicada.

Para revisar o borrar triggers instalados, usá el ícono de reloj (**Triggers**) en el editor de Apps Script, o `ScriptApp.getProjectTriggers()` / `ScriptApp.deleteTrigger(trigger)` desde código.
