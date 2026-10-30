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

   Opcionalmente, podés fijar qué implementación redesplegá `pnpm deploy` por defecto agregando a `.env`:

   ```
   CLASP_DEPLOYMENT_ID=tu_deployment_id_aqui
   ```

   Sin esta variable, `pnpm deploy` elige automáticamente la implementación con el número de versión más alto (ver "Desplegar la web app" más abajo).

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
| `pnpm deploy` | Build limpio + push + redeploy automático de la implementación actual (flujo recomendado, ver "Desplegar la web app") |
| `pnpm migrate` | Build + push (sin redeploy) + ejecuta la función `migrate` en Apps Script con `clasp run` (ver más abajo) |
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
<?!= include('app/views/partials/header', { appName: appName, appUrl: appUrl }) ?>
```

- `<?= ... ?>` escapa HTML: usalo para cualquier dato.
- `<?!= ... ?>` no escapa: usalo solo para `include` de parciales, nunca con datos del usuario.
- `include(nombre, datos)` evalúa el parcial como template: sus scriptlets solo ven los `datos` que le pases, no las variables de la vista que lo incluye.
- La app de ejemplo trae dos vistas, `/` (login) y `/profile`, y tres parciales: `head` (Pico CSS), `header` (navegación) y `session` (manejo del token).
- **Links entre vistas:** la web app corre dentro de un iframe de `googleusercontent.com`, así que un link relativo como `?route=/profile` no apunta a tu script. Cada vista recibe `appUrl` (`ScriptApp.getService().getUrl()`, que en `/dev` devuelve la URL `/dev`) y los links se arman así: `<a href="<?= appUrl ?>?route=/profile">`.
- **Sesión compartida:** el parcial `session` expone `AppSession` (`getToken`, `setToken`, `clear`, `loadUser`). El token vive en `sessionStorage`, que se comparte entre las vistas de la misma pestaña y se borra al cerrarla. Una vista protegida solo hace `AppSession.loadUser(mostrarDatos, mostrarLogin)`, y `loadUser` valida el token contra `POST /me`.
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

`/dev` siempre sirve el último código subido (el que deja `clasp push`). La URL `.../exec` queda fija en la **versión** con la que se creó cada implementación: subir código nuevo no alcanza para que `/exec` lo vea, hace falta un `redeploy` que apunte esa implementación a una versión nueva.

### Primera implementación (una sola vez)

1. `pnpm run deploy --push-only` (sube el código sin tocar implementaciones, porque todavía no existe ninguna).
2. En el editor (`pnpm open`): **Implementar → Nueva implementación → Aplicación web**.
3. Elegí **Ejecutar como** y **Quién tiene acceso** según tu caso. Con "Ejecutar como: yo", la app lee y escribe las sheets con tus permisos.
4. Abrí la URL `.../exec`: `GET /` muestra la pantalla de login de ejemplo.

### Despliegues siguientes

`pnpm deploy` es el flujo recomendado: buildea, pushea y después **redespliega automáticamente** la implementación existente, sin crear una nueva ni cambiar la URL `/exec`.

```bash
pnpm run deploy
```

Cómo elige qué implementación redesplegar, en este orden de prioridad:

1. `--deployment <id>`, si lo pasás en la línea de comandos.
2. `CLASP_DEPLOYMENT_ID`, si lo definís en `.env` (ver "Configuración del proyecto").
3. Si ninguno de los dos está presente, la implementación con el **número de versión más alto** (ignora la entrada `@HEAD`, que no tiene `versionNumber` y nunca se redespliega).

Si no hay ninguna implementación con versión (proyecto sin implementaciones todavía), el script falla y sugiere `--new` en vez de crear una implementación sola.

### Flags disponibles

| Flag | Qué hace | Ejemplo |
|---|---|---|
| (ninguno) | Build limpio + push + redeploy de la implementación elegida según la prioridad de arriba | `pnpm run deploy` |
| `--push-only` | Build + push, sin tocar implementaciones. Útil para la primera implementación o cuando solo querés actualizar `/dev` | `pnpm run deploy --push-only` |
| `--new` | Build + push + crea una implementación **nueva** (URL `/exec` nueva), en vez de redesplegar la existente. No se puede combinar con `--deployment` ni `--push-only` | `pnpm run deploy --new` |
| `--deployment <id>` | Fija qué implementación redesplegar para esta corrida, por encima de `CLASP_DEPLOYMENT_ID` | `pnpm run deploy --deployment AKfycb...` |
| `--description <texto>` | Descripción de la versión/implementación creada. Por defecto usa una fecha | `pnpm run deploy --description "fix login"` |
| `--force` | Agrega `--force` a `clasp push`, para sobrescribir el manifest remoto cuando clasp frena el push (ver abajo) | `pnpm run deploy --force` |
| `--dry-run` | No hace build, push ni redeploy: solo lista las implementaciones existentes (lectura) y muestra qué haría | `pnpm run deploy --dry-run` |

**Importante:** usá `pnpm run deploy <flags>`, no `pnpm deploy <flags>`. pnpm tiene un comando interno `deploy` que intercepta esa forma y rechaza cualquier flag que no sea suyo (`Unknown option`). `pnpm run deploy` evita ese comando interno y pasa los flags directo al script.

### El freno de seguridad `Skipping push.`

Si el `appsscript.json` remoto cambió (por ejemplo, Google agrega un bloque `webapp` al crear una implementación de web app), clasp pregunta si sobrescribirlo; la respuesta por defecto es **No**, así que `clasp push` no sube nada y queda la línea `Skipping push.` en la salida. `pnpm deploy` detecta ese caso (o que `clasp push` termine con error) y **frena ahí**: nunca lista ni redespliega implementaciones con código viejo. El mensaje te indica copiar el cambio a `src/appsscript.json`, o volver a correr con `--force` para sobrescribir el manifest remoto a propósito.

```bash
pnpm run deploy --force --description "force push after manifest change"
```

### Quién puede abrir la web app (`access` y `executeAs`)

Se configura en el bloque `webapp` de `src/appsscript.json`:

```json
"webapp": {
  "executeAs": "USER_DEPLOYING",
  "access": "ANYONE_ANONYMOUS"
}
```

`webapp.access` define quién puede abrir la URL:

| Valor | En el editor figura como | Quién entra |
|---|---|---|
| `MYSELF` | Solo yo | Solo el dueño del script |
| `DOMAIN` | Cualquier usuario de tu dominio | Solo cuentas de tu Google Workspace (no disponible con cuentas Gmail personales) |
| `ANYONE` | Cualquier usuario con una cuenta de Google | Cualquiera con su cuenta de Google iniciada |
| `ANYONE_ANONYMOUS` | Cualquier usuario | Cualquiera, sin iniciar sesión en Google |

`webapp.executeAs` define con qué permisos corre el script:

| Valor | Corre como | Cuándo usarlo |
|---|---|---|
| `USER_DEPLOYING` | El dueño del script | Para esta app: las sheets se leen y escriben con tus permisos y los visitantes no necesitan acceso a ellas |
| `USER_ACCESSING` | Quien abre la URL | Cuando cada usuario debe operar sobre sus propios archivos. Cada visitante necesita acceso a la sheet y autorizar el script; no es compatible con `ANYONE_ANONYMOUS` |

La app de ejemplo usa `USER_DEPLOYING` + `ANYONE_ANONYMOUS`: el login lo resuelve la propia app (usuarios en la sheet y JWT), así que los visitantes no necesitan cuenta de Google. `migrate` y `createUser` siguen protegidos, porque un visitante anónimo no tiene email y `assertAdmin()` lo rechaza.

Para cambiarlo, editá `src/appsscript.json` y corré `pnpm run deploy`: el redeploy publica una versión nueva con ese manifest. **No lo cambies desde el editor de Apps Script** (Administrar implementaciones): eso modifica el manifest remoto y el próximo deploy frena con `Skipping push.`.

`executionApi.access` admite los mismos cuatro valores, pero define quién puede invocar funciones con `clasp run`. Dejalo en `MYSELF`.


## Ejecutar `migrate` y `createUser` desde la terminal

`pnpm migrate` hace dos cosas: build + `clasp push` (sin redeploy, equivalente a `pnpm run deploy --push-only`) y después `clasp run migrate`, que ejecuta la función ya subida a través de la **Apps Script Execution API**.

Son dos logins distintos:

| Comando | Login que necesita |
|---|---|
| `clasp push`, `pull`, `open` | El `clasp login` normal (credenciales por defecto de clasp, en `~/.clasprc.json`) |
| `clasp run` (y por lo tanto `pnpm migrate`) | `clasp login --creds` con **un cliente OAuth propio**, de un proyecto de Google Cloud **vinculado a tu script** |

Por eso `pnpm deploy` puede funcionar y `pnpm migrate` fallar con:

```
Unable to run script function. Please make sure you have permission to run the script function.
```

Ese mensaje significa que la Execution API rechazó las credenciales (`NOT_AUTHORIZED`); tu función ni llegó a ejecutarse.

### Configurar las credenciales (una sola vez por proyecto)

1. **Proyecto de Google Cloud.** En [Google Cloud Console](https://console.cloud.google.com/), creá un proyecto (o usá uno tuyo). Anotá su **número de proyecto** (Panel → Información del proyecto); no confundir con el ID.
2. **Habilitar la API.** En **APIs y servicios → Biblioteca**, buscá **Apps Script API** y habilitala.
3. **Pantalla de consentimiento OAuth.** En **APIs y servicios → Pantalla de consentimiento de OAuth** (o **Google Auth Platform**), configurala. Si el tipo es **Externo**, agregá tu email en **Usuarios de prueba**; sin eso, el login falla con "acceso bloqueado".
4. **Cliente OAuth.** En **APIs y servicios → Credenciales → Crear credenciales → ID de cliente de OAuth**, elegí el tipo **App de escritorio**. Descargá el JSON y guardalo en la raíz del repo como `client_secret.json`.
5. **Vincular el script.** En el editor del script (`pnpm open`): **Configuración del proyecto → Proyecto de Google Cloud Platform (GCP) → Cambiar proyecto**, y pegá el **número** del paso 1.
6. **Login con esas credenciales**, desde la raíz del repo, incluyendo los scopes que usa el script:

   ```bash
   clasp login --creds client_secret.json \
     --extra-scopes https://www.googleapis.com/auth/spreadsheets,https://www.googleapis.com/auth/userinfo.email
   ```

7. **Verificar.** Tiene que aparecer un `.clasprc.json` en la raíz del repo. Si no está, `clasp run` sigue usando las credenciales por defecto y va a fallar.

### Correr las migraciones y crear usuarios

```bash
pnpm migrate
```

```bash
clasp run createUser -p '["vos@ejemplo.com", "un-password-largo", "tu-username"]'
```

El password del segundo comando queda en el historial de tu shell; borralo después.

Antes de correrlos, cargá tu email en la Script Property `ADMIN_EMAILS`: si no, las dos funciones responden `Forbidden`.

### Alternativa sin Google Cloud: correr las funciones desde el editor

Si todavía no configuraste las credenciales, podés ejecutar a mano el código ya subido. Este camino está probado contra un proyecto real. En los dos casos tu email tiene que estar en la Script Property `ADMIN_EMAILS`.

**`migrate`:**

1. `pnpm deploy`.
2. `pnpm open`, elegí `migrate` en el selector de funciones y tocá **Ejecutar**.
3. La primera vez, aceptá los permisos que pide Google.

**`createUser`:** el botón **Ejecutar** no pasa argumentos, así que hace falta una función temporal sin parámetros:

1. En el editor, al final del archivo `bundle` (o en un archivo nuevo, **+ → Secuencia de comandos**), agregá:

   ```javascript
   function tmp() {
     createUser('vos@ejemplo.com', 'un-password-largo', 'tu-username');
   }
   ```

2. Guardá, elegí `tmp` en el selector de funciones y tocá **Ejecutar**.
3. **Borrá `tmp` enseguida y guardá.** Mientras exista, el password queda en texto plano en el código del proyecto. Además, como cualquier función global, `tmp` se puede invocar desde el navegador con `google.script.run` (`assertAdmin()` igual bloquea a quien no sea admin).

El próximo `pnpm deploy` reemplaza el bundle y elimina los archivos que no están en `dist/`, así que ese cambio manual no sobrevive a un deploy. No lo uses para nada permanente: el código permanente va en `src/`.

### Errores comunes

| Mensaje | Causa probable |
|---|---|
| `Unable to run script function. Please make sure you have permission...` | No hay `.clasprc.json` en el repo (falta el paso 6), o el cliente OAuth es de un proyecto de Cloud distinto al vinculado en el paso 5, o la Apps Script API no está habilitada en ese proyecto. |
| `Script function not found. Please make sure script is deployed as API executable.` | La función no está en el bundle subido: corré `pnpm deploy` y revisá que esté exportada desde `src/index.ts`. |
| `Forbidden` | Tu email no está en la Script Property `ADMIN_EMAILS`. |
| `pnpm deploy` termina con `Skipping push.` y no se ve ningún cambio | El `appsscript.json` remoto cambió (por ejemplo, al crear una implementación de web app, Google agrega un bloque `webapp`). clasp pregunta si sobrescribirlo y la respuesta por defecto es **No**, así que no sube nada. Copiá ese cambio a `src/appsscript.json` para que coincidan y volvé a correr `pnpm deploy`. Para ver el manifest remoto, usá `pnpm open` → **Configuración del proyecto → Mostrar el archivo de manifiesto**. |
| `Missing script property: ...` | Falta cargar esa Script Property (ver "Configuración del proyecto"). |
| Errores de permisos o scopes insuficientes | El login no incluye un scope que usa el script. Repetí el paso 6 sumando el scope a `--extra-scopes` (por ejemplo Drive, si lo agregás). |

### Notas de seguridad

- `.clasprc.json` contiene tu token de acceso y `client_secret.json` el secreto del cliente OAuth. Los dos están en `.gitignore`: **nunca los subas** (este repo es público).
- `appsscript.json` declara `executionApi.access: "MYSELF"`, así que solo el dueño del script puede invocarlo por la API. La documentación de clasp muestra `ANYONE` en su ejemplo; si cambiás el acceso, `assertAdmin()` sigue protegiendo `migrate` y `createUser`.
- Estos pasos siguen la documentación de clasp 3; el flujo completo de `clasp run` todavía no se probó de punta a punta contra un proyecto real.

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
