# base-clasp-ts

Base para desarrollar automatizaciones y web apps de **Google Apps Script** (Google Sheets, Docs, Drive, etc.) usando **TypeScript** y **clasp**.

Incluye un mini framework estilo "Laravel-lite" sobre Google Sheets: router con middleware, modelos CRUD, migraciones, autenticación con JWT y vistas con HtmlService, todo testeable localmente con Node.

## Requisitos previos

- [Node.js](https://nodejs.org/) 22.6 o superior (los scripts usan `--experimental-strip-types`).
- [pnpm](https://pnpm.io/) instalado globalmente:

  ```bash
  npm install -g pnpm
  ```

- [clasp](https://github.com/google/clasp) 3.x instalado globalmente:

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

4. Cargar las **Script Properties** que usa la app de ejemplo, en el editor de Apps Script: **Configuración del proyecto → Propiedades de la secuencia de comandos**:

   | Propiedad | Para qué sirve |
   |---|---|
   | `JWT_SECRET` | Firma los tokens de sesión. Usá un valor largo y aleatorio. |
   | `ADMIN_EMAILS` | Emails (separados por coma) que pueden ejecutar `migrate` y `createUser`. |

   Para generar un `JWT_SECRET`:

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
   ```

   Los secretos viven en Script Properties, nunca en el código ni en la sheet. Si falta alguno, o está vacío, la función que lo necesita falla con `Missing script property: <NOMBRE>`.

## Estructura del proyecto

```
src/
  appsscript.json        # Manifest de Apps Script (timezone, servicios, runtime, executionApi)
  index.ts               # Punto de entrada: TODO lo que exportes acá queda como función global de GAS
  utils.ts
  core/                  # El framework: no se toca en cada proyecto
    router.ts            # Rutas GET/POST + middleware
    http.ts              # Convierte el evento de doGet/doPost en un Request
    model.ts             # CRUD sobre una sheet (filtros, paginación, soft delete, ids)
    migration.ts         # MigrationRunner (migrate / rollback)
    auth.ts              # Hash de passwords y JWT HS256
    view.ts              # view() / json() y conversión a salida de GAS
    sheet-adapter.ts     # Contratos (interfaces) que aíslan las APIs de Google
    schema-adapter.ts
    crypto-adapter.ts
    output-adapter.ts
    gas-*-adapter.ts     # Implementaciones reales sobre SpreadsheetApp, Utilities, HtmlService
    testing/             # Dobles de test en memoria (no se incluyen en el bundle)
  app/                   # Tu aplicación
    routes.ts
    controllers/
    middleware/
    models/
    migrations/
    views/               # Templates .html de HtmlService
scripts/
  build.ts               # Bundle con esbuild hacia dist/
dist/                    # Salida del build (no se versiona)
setup-clasp.ts           # Genera .clasp.json a partir de CLASP_SCRIPT_ID
```

## Cómo funciona el build

Apps Script **no tiene sistema de módulos**: cada archivo subido se ejecuta como un script global, y un `import`/`export` ahí es un error de sintaxis. Por eso el build no usa `tsc` para generar código:

- `pnpm typecheck` corre `tsc` solo para chequear tipos (no genera archivos).
- `scripts/build.ts` usa **esbuild** para empaquetar `src/index.ts` y todo lo que importa en un único `dist/bundle.js`, sin sintaxis de módulos.
- Por cada `export` de `src/index.ts`, el build agrega al final del bundle una función global con el mismo nombre. Así Apps Script encuentra `doGet`, `doPost`, triggers y las funciones que corrés desde el editor o con `clasp run`.
- Los `.html` de `src/` se copian a `dist/` con la misma ruta: `src/app/views/index.html` queda en GAS como `app/views/index`.

Consecuencias prácticas:

- En el editor de Apps Script vas a ver **un solo archivo** (`bundle`) y no la estructura de carpetas. La separación vive en `src/`, que es donde trabajás. No edites el bundle en el editor: el próximo `pnpm deploy` lo pisa.
- Una función que no se exporta desde `src/index.ts` **no existe** para Apps Script, aunque esté declarada en otro archivo.
- `pnpm pull` trae el bundle a `dist/`, no tu código fuente. Sirve para inspeccionar lo que está subido, no para recuperar código.

## Comandos

| Comando | Qué hace |
|---|---|
| `pnpm test` | Corre todos los tests (`src/**/*.test.ts` y `scripts/**/*.test.ts`) con `node:test` |
| `pnpm typecheck` | Chequea tipos con `tsc` |
| `pnpm build` | Typecheck + bundle en `dist/` |
| `pnpm build:clean` | Borra `dist/` y vuelve a buildear |
| `pnpm push` | Regenera `.clasp.json` y sube `dist/` al proyecto de Apps Script |
| `pnpm deploy` | Build limpio + push (flujo recomendado) |
| `pnpm migrate` | Deploy + ejecuta la función `migrate` en Apps Script con `clasp run` (ver más abajo) |
| `pnpm pull` | Trae lo que está subido en Apps Script a `dist/` |
| `pnpm open` | Abre el proyecto en el editor web de Apps Script |

### Flujo de trabajo típico

1. Escribir o modificar código en `src/`.
2. `pnpm test` para validar la lógica localmente.
3. `pnpm deploy` para buildear y subir.
4. Probar en el editor (`pnpm open`) o en la web app desplegada.

## Guía del framework

### 1. Migraciones (estructura de las sheets)

Una migración crea o borra sheets. Creá `src/app/migrations/002_create_posts.ts`:

```typescript
import type { Migration } from '../../core/migration.ts';

export const createPostsMigration: Migration = {
  name: '002_create_posts',
  up(schema) {
    schema.createSheet('posts', ['id', 'title', 'body', 'created_at', 'updated_at', 'deleted_at']);
  },
  down(schema) {
    schema.dropSheet('posts');
  },
};
```

Y sumala, en orden, a `src/app/migrations/index.ts`:

```typescript
export const migrations: Migration[] = [createUsersMigration, createPostsMigration];
```

`MigrationRunner` guarda las migraciones aplicadas en una sheet `migrations`, así que correr `migrate` dos veces no repite nada. `rollback(steps)` deshace las últimas, de la más reciente a la más vieja.

### 2. Modelos (CRUD)

```typescript
import type { SheetAdapter } from '../../core/sheet-adapter.ts';
import { Model } from '../../core/model.ts';

export function postsModel(adapter: SheetAdapter): Model {
  return new Model('posts', adapter);
}
```

Uso:

```typescript
const posts = postsModel(adapter);
posts.create({ title: 'Hola', body: '...' });          // asigna id y created_at/updated_at
posts.find(1);                                           // fila o null
posts.all({ where: (row) => row.title === 'Hola' });
posts.paginate(1, 10);                                   // { page, perPage, total, pages, data }
posts.update(1, { title: 'Nuevo título' });
posts.delete(1);                                         // soft delete si la sheet tiene deleted_at
```

Reglas: la columna `id` se autoincrementa; `created_at`/`updated_at` se completan solo si existen en la sheet; si existe `deleted_at`, `delete` marca la fila y `all`/`find` la ocultan (salvo `{ includeDeleted: true }`).

### 3. Rutas, controladores y middleware

Las rutas se registran en `src/app/routes.ts`, dentro de `createRouter`:

```typescript
router.get('/posts', () => view('app/views/posts', { posts: postsModel(adapter).all() }));

router.post('/posts', (request) => {
  const post = postsModel(adapter).create({ title: String(request.body.title ?? '') });
  return { status: 200, body: post };
}, requireAuth);
```

- Un handler recibe un `Request` (`path`, `method`, `params`, `body`, `context`) y devuelve `{ status, body }`.
- Un middleware recibe `(request, next)`: llama a `next()` para seguir o devuelve una respuesta para cortar. `authMiddleware` valida el token del body y deja `context.userId` para el handler.
- El matching es exacto por `path` + método. Una web app de GAS no tiene rutas reales en la URL, así que `doGet`/`doPost` toman la ruta del parámetro `route`: `https://script.google.com/macros/s/<ID>/exec?route=/posts`.
- **Apps Script no permite elegir el status HTTP**: siempre responde 200. El `status` de la respuesta sirve dentro del framework (middleware, tests y el cliente), no llega al navegador como código HTTP.

### 4. Vistas

Los templates van en `src/app/views/` y se devuelven con `view(nombre, datos)`; cada clave de `datos` queda disponible en el template:

```html
<h1><?= appName ?></h1>
<?!= include('app/views/partials/header') ?>
```

- `<?= ... ?>` escapa HTML: usalo para cualquier dato.
- `<?!= ... ?>` no escapa: usalo solo para `include` de parciales, nunca con datos del usuario.
- Desde el navegador, hablá con el servidor con `google.script.run.api(ruta, body)`, que pasa por el mismo router y middleware y devuelve el `body` de la respuesta:

  ```javascript
  google.script.run
    .withSuccessHandler((result) => { /* ... */ })
    .api('/login', { email, password });
  ```

- En el DOM, mostrá datos con `textContent`, no con `innerHTML`.

### 5. Autenticación

La app de ejemplo trae `POST /login` (email + password → `{ token }`) y `POST /me` (usuario actual, requiere `token` en el body):

- Los passwords se guardan como `iteraciones$salt$hash` (salt aleatorio + HMAC-SHA256 iterado; Apps Script no tiene bcrypt). El campo `password` nunca aparece en una respuesta.
- Los tokens son JWT HS256 firmados con `JWT_SECRET`, con expiración obligatoria.
- El token se guarda en `sessionStorage` y viaja solo en el body de `google.script.run`, **nunca en la URL** (quedaría en el historial y en los logs).
- Un email inexistente y un password incorrecto devuelven el mismo error, con el mismo trabajo de cómputo, para no revelar qué emails existen.
- No hay registro público: los usuarios se crean con `createUser` (ver más abajo).

### 6. Funciones globales y seguridad

Todo lo que exportás desde `src/index.ts` queda como función global, y **cualquier función global puede invocarse desde el navegador** con `google.script.run.<nombre>(...)` por quien abra la web app. Por eso:

- `migrate` y `createUser` empiezan con `assertAdmin()`, que exige que el usuario activo esté en `ADMIN_EMAILS`. Copiá ese patrón en cualquier función administrativa nueva.
- No exportes helpers internos desde `src/index.ts` si no necesitás que sean globales.

## Desplegar la web app

1. `pnpm deploy`.
2. En el editor (`pnpm open`): **Implementar → Nueva implementación → Aplicación web**.
3. Elegí **Ejecutar como** y **Quién tiene acceso** según tu caso. Con "Ejecutar como: yo", la app lee y escribe las sheets con tus permisos.
4. Abrí la URL `.../exec`: `GET /` muestra la pantalla de login de ejemplo.

## Ejecutar `migrate` y `createUser` desde la terminal

`pnpm migrate` corre `clasp run migrate`, que llama a la función ya subida mediante la Apps Script Execution API. Para usarlo, clasp necesita **tus propias credenciales OAuth** (según la documentación de `clasp run`):

1. Crear un proyecto en [Google Cloud Console](https://console.cloud.google.com/) y habilitar la **Apps Script API**.
2. Crear un cliente OAuth de tipo **Aplicación de escritorio** y descargar el JSON (por ejemplo `client_secret.json` en la raíz del repo).
3. Vincular el script a ese proyecto: en el editor, **Configuración del proyecto → Proyecto de Google Cloud Platform → Cambiar proyecto**, con el número del proyecto.
4. Loguearte con esas credenciales y los scopes que usa el script:

   ```bash
   clasp login --creds client_secret.json \
     --extra-scopes https://www.googleapis.com/auth/spreadsheets,https://www.googleapis.com/auth/userinfo.email
   ```

5. Correr las migraciones:

   ```bash
   pnpm migrate
   ```

6. Crear un usuario:

   ```bash
   clasp run createUser -p '["vos@ejemplo.com", "un-password-largo"]'
   ```

   El password queda en el historial de tu shell; borralo después o cargá el usuario desde un script que lo pida por consola.

Notas:

- `clasp login --creds` guarda un token en `.clasprc.json` dentro del proyecto. Ese archivo y los `client_secret*.json` están en `.gitignore`: **nunca los subas**.
- `appsscript.json` declara `executionApi.access: "MYSELF"`, así que solo el dueño del script puede invocarlo por la API. La documentación de clasp muestra `ANYONE` en su ejemplo; si cambiás el acceso, `assertAdmin()` sigue protegiendo `migrate` y `createUser`.
- Si `clasp run` falla por permisos, revisá que el login incluya todos los scopes que usa el script (por ejemplo, Drive si lo agregás).
- Esta configuración se armó siguiendo la documentación de clasp 3, pero todavía no se probó contra un proyecto real.

## Tests

- `pnpm test` corre los tests con el runner nativo de Node (`node:test`), directo sobre el TypeScript y sin dependencias extra.
- La lógica del framework no llama a `SpreadsheetApp`, `Utilities` ni `HtmlService` de forma directa: pasa por adapters. En los tests se usan los dobles en memoria de `src/core/testing/` (por ejemplo `InMemorySheetAdapter`), y en producción los `gas-*-adapter.ts`.
- `scripts/build.test.ts` ejecuta el bundle en un sandbox de Node para comprobar que no tiene sintaxis de módulos y que las funciones globales existen.

Reglas para escribir código que corra tanto en los tests como en el bundle:

- Los imports de valores llevan extensión `.ts` explícita (`import { Model } from './model.ts'`); los de tipos van con `import type`.
- No uses *parameter properties* en constructores (`constructor(private x: string)`) ni `enum`: Node solo borra tipos y rechaza esa sintaxis. Declará los campos y asignalos en el constructor.

## Agregar servicios avanzados (Sheets, Drive, etc.)

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

Apps Script ofrece dos tipos de triggers para automatizar la ejecución de funciones. En los dos casos, la función tiene que estar **exportada desde `src/index.ts`** para que el build la convierta en global (ver "Cómo funciona el build").

### Triggers simples

Se detectan automáticamente por el nombre de la función, sin configuración adicional:

```typescript
// src/index.ts
export function onOpen(): void {
  // Se ejecuta cada vez que se abre el Google Sheet
  SpreadsheetApp.getUi().createMenu('Mi Menú').addItem('Ejecutar', 'main').addToUi();
}

export function onEdit(e: GoogleAppsScript.Events.SheetsOnEdit): void {
  // Se ejecuta cada vez que se edita una celda
  Logger.log(`Celda editada: ${e.range.getA1Notation()}`);
}
```

Limitación: los triggers simples no pueden acceder a servicios que requieran autorización de terceros (por ejemplo, enviar correos) ni ejecutarse si el editor no es el propietario de la hoja.

### Triggers instalables (time-driven, on form submit, etc.)

Para disparadores programados (por tiempo) o que necesitan permisos ampliados, hay que crearlos manualmente, ya sea desde el editor de Apps Script (**Triggers → Add Trigger**) o por código con `ScriptApp`:

```typescript
// src/index.ts
export function crearTriggerDiario(): void {
  ScriptApp.newTrigger('main')
    .timeBased()
    .everyDays(1)
    .atHour(6)
    .create();
}
```

Ejecutá `crearTriggerDiario` una sola vez desde el editor de Apps Script (`pnpm open`) para registrar el trigger; después de eso, `main` correrá sola todos los días a la hora indicada.

Para revisar o borrar triggers instalados, usá el ícono de reloj (**Triggers**) en el editor de Apps Script, o `ScriptApp.getProjectTriggers()` / `ScriptApp.deleteTrigger(trigger)` desde código.
