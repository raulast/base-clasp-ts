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
   | `ADMIN_EMAILS` | Emails (separados por coma) que pueden ejecutar `migrate`, `createUser` y `seed`. |
   | `MEDIA_FOLDER_ID` | Carpeta de Drive donde se guardan los archivos subidos al blog (ver "Archivos en Drive" más abajo). |

   Para generar un `JWT_SECRET`:

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
   ```

   Los secretos viven en Script Properties, nunca en el código ni en la sheet. Si falta alguno, o está vacío, la función que lo necesita falla con `Missing script property: <NOMBRE>`.

   Cada request autenticado lee `JWT_SECRET`, y las lecturas de Properties tienen una cuota diaria (50.000 por día en cuentas Gmail). Por eso `getScriptSecret` guarda los valores en `CacheService` durante 10 minutos (`SECRET_CACHE_SECONDS`): si cambiás o rotás un secreto, el valor nuevo puede tardar hasta 10 minutos en aplicarse. Si el caché falla o perdió el dato, se vuelve a leer Properties.

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
    api.ts               # HttpError, envelope JSON (ok/fail), factories de error
    relations.ts         # hasMany, belongsTo, belongsToMany (+ attach/detach/sync), sameId
    seeder.ts            # Seeder, runSeeders
    lock-adapter.ts      # LockAdapter, noopLock (concurrencia sobre Model.create/update/delete)
    media-rules.ts       # Validación de uploads: MIME permitidos, tamaño máximo, nombre seguro
    storage-adapter.ts   # Contrato para guardar/compartir/leer archivos (Drive)
    slug.ts              # slugify()
    gas-*-adapter.ts     # Implementaciones reales sobre SpreadsheetApp, Utilities, HtmlService, DriveApp, LockService
    testing/             # Dobles de test en memoria (no se incluyen en el bundle)
  app/                   # Tu aplicación
    routes.ts
    controllers/
    middleware/
    models/
    policies/            # Reglas de autorización puras: (usuario, registro) -> boolean
    migrations/
    seeders/             # Datos iniciales idempotentes (tags, etc.)
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
- Los `.html` de `src/` se copian a `dist/` con la misma ruta: `src/app/views/home.html` queda en GAS como `app/views/home`.

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

Las rutas se registran en `src/app/routes.ts`, dentro de `createRouter`. `routes.ts` solo mapea método + path (+ middleware) a una acción de controlador: nunca lee `request.body`, nunca arma la respuesta, nunca llama a un modelo directamente. La lógica vive en los controladores (`src/app/controllers/`) y en los modelos (`src/app/models/`):

```typescript
router.group('/api/v1', [], (group) => {
  group.get('/posts', posts.list, mayAuth);
  group.post('/posts', posts.create, mustAuth);
  group.patch('/posts/:id', posts.update, mustAuth);
});
```

- Un handler recibe un `Request` (`path`, `method`, `params`, `pathParams`, `body`, `user`) y devuelve `{ status, body }`. `router.group(prefix, middleware, build)` agrupa rutas bajo un prefijo y una lista de middleware compartidos.
- Soporta segmentos `:nombre` (`/posts/:id`), que quedan en `request.pathParams` (`request.params` es siempre el query string).
- Un middleware recibe `(request, next)`: llama a `next()` para seguir o lanza/devuelve una respuesta para cortar. `requireAuth`/`optionalAuth` (`src/app/middleware/auth.middleware.ts`) validan el token del body y dejan el usuario en `request.user`.
- El matching es exacto por `path` + método; las rutas estáticas ganan sobre las de parámetro. Si el path existe para otro método, responde 405 con `details.allowed`; si no existe para ningún método, 404.
- Como no hay rutas reales en la URL de una web app de GAS, `doGet`/`doPost` toman la ruta del parámetro `route`: `$APP_URL?route=/posts`. El `event` de GAS sí trae `pathInfo` (todo lo que sigue a `/exec/`), pero ese camino redirige a cualquier cliente anónimo a la pantalla de inicio de sesión de Google antes de llegar al script (verificado en una implementación `ANYONE_ANONYMOUS`), así que no sirve para una API pública.
- **Apps Script no permite elegir el status HTTP**: siempre responde 200. El `status` de la respuesta es el código del envelope JSON (ver `docs/api.md`), no llega al navegador como código HTTP.
- Cualquier `HttpError` (`src/core/api.ts`) lanzado en un middleware o handler se convierte en el envelope de error correspondiente; cualquier otro error no controlado se convierte en 500 `INTERNAL` con un mensaje fijo, nunca el mensaje ni el stack original.

### 4. Vistas

Los templates van en `src/app/views/` y se devuelven con `view(nombre, datos)`; cada clave de `datos` queda disponible en el template:

```html
<h1><?= appName ?></h1>
<?!= include('app/views/partials/header', { appName: appName, appUrl: appUrl }) ?>
```

- `<?= ... ?>` escapa HTML: usalo para cualquier dato.
- `<?!= ... ?>` no escapa: usalo solo para `include` de parciales, nunca con datos del usuario.
- `include(nombre, datos)` evalúa el parcial como template: sus scriptlets solo ven los `datos` que le pases, no las variables de la vista que lo incluye.
- La app de ejemplo trae las vistas `/` (home del blog), `/posts/:slug` (detalle), `/login`, `/register`, `/profile`, `/dashboard`, `/dashboard/posts/new` y `/dashboard/posts/:id/edit` (editor), `/admin/users` y `/admin/tags`; y parciales `head` (Pico CSS), `header` (navegación), `session` (manejo del token) y `client` (`App`, el cliente JS compartido para hablar con la API).
- **Links entre vistas:** la web app corre dentro de un iframe de `googleusercontent.com`, así que un link relativo como `?route=/profile` no apunta a tu script. Cada vista recibe `appUrl` (`ScriptApp.getService().getUrl()`, que en `/dev` devuelve la URL `/dev`) y los links se arman así: `<a href="<?= appUrl ?>?route=/profile">`.
- **Sesión compartida:** el parcial `session` expone `AppSession` (token en `sessionStorage`, compartido entre las vistas de la misma pestaña y borrado al cerrarla) junto con el rol del usuario cargado. El parcial `client` expone `App`, que envías a la API con el mismo contrato que un cliente externo (ver `docs/api.md`): `App.call(route, body)`, `App.get(route, params)` (manda `_method: GET` + token), `App.send(route, method, body)` (POST/PATCH/DELETE + token), y helpers de DOM (`App.el`, `App.paragraphs`) que solo usan `textContent`, nunca `innerHTML`.
- Las vistas son shells sin datos: todo lo que muestran lo piden a la API con las mismas políticas que un cliente externo, así que ninguna página necesita chequear permisos del lado del servidor — la API es la única autoridad.

### 5. Autenticación

La API trae `POST /api/v1/auth/register` (público, siempre crea un `reader`), `POST /api/v1/auth/login` (email + password → `{ token }`) y `GET /api/v1/auth/me` (usuario actual, requiere token; también alcanzable como `POST` + `_method: "GET"`). Detalle completo de la API en `docs/api.md`.

- Los passwords se guardan como `iteraciones$salt$hash` (salt aleatorio + HMAC-SHA256 iterado; Apps Script no tiene bcrypt). El campo `password` nunca aparece en una respuesta.
- Los tokens son JWT HS256 firmados con `JWT_SECRET`, con expiración obligatoria.
- El token viaja solo en el body (nunca hay header `Authorization`: el `event` de GAS no expone headers personalizados al script) y, desde el navegador, se guarda en `sessionStorage` y nunca en la URL (quedaría en el historial y en los logs).
- Un email inexistente y un password incorrecto devuelven el mismo error, con el mismo trabajo de cómputo, para no revelar qué emails existen. Un usuario deshabilitado recibe el mismo error genérico.
- Roles: `admin` | `author` | `reader`. El registro público siempre crea un `reader`; los admins cambian roles y habilitan/deshabilitan usuarios desde `/admin/users`. El primer admin se crea desde la terminal o el editor (ver "Primer admin" más abajo).

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
4. Abrí la URL `.../exec`: `GET /` muestra la home del blog de ejemplo.

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

La app de ejemplo usa `USER_DEPLOYING` + `ANYONE_ANONYMOUS`: el login lo resuelve la propia app (usuarios en la sheet y JWT), así que los visitantes no necesitan cuenta de Google. `migrate`, `createUser` y `seed` siguen protegidos, porque un visitante anónimo no tiene email y `assertAdmin()` lo rechaza.

Para cambiarlo, editá `src/appsscript.json` y corré `pnpm run deploy`: el redeploy publica una versión nueva con ese manifest. **No lo cambies desde el editor de Apps Script** (Administrar implementaciones): eso modifica el manifest remoto y el próximo deploy frena con `Skipping push.`.

`executionApi.access` admite los mismos cuatro valores, pero define quién puede invocar funciones con `clasp run`. Dejalo en `MYSELF`.


## Ejecutar `migrate`, `createUser` y `seed` desde la terminal

`pnpm migrate` hace dos cosas: build + `clasp push` (sin redeploy, equivalente a `pnpm run deploy --push-only`) y después `clasp run migrate`, que ejecuta la función ya subida a través de la **Apps Script Execution API**. `pnpm seed` hace lo mismo con la función `seed` (ver "Seeders" más abajo).

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

### Correr las migraciones, crear usuarios y poblar datos

```bash
pnpm migrate
```

```bash
clasp run createUser -p '["vos@ejemplo.com", "un-password-largo", "tu-username", "admin"]'
```

```bash
pnpm seed
```

El password del segundo comando queda en el historial de tu shell; borralo después.

Antes de correrlos, cargá tu email en la Script Property `ADMIN_EMAILS`: si no, las tres funciones responden `Forbidden`.

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
     createUser('vos@ejemplo.com', 'un-password-largo', 'tu-username', 'admin');
   }
   ```

2. Guardá, elegí `tmp` en el selector de funciones y tocá **Ejecutar**.
3. **Borrá `tmp` enseguida y guardá.** Mientras exista, el password queda en texto plano en el código del proyecto. Además, como cualquier función global, `tmp` se puede invocar desde el navegador con `google.script.run` (`assertAdmin()` igual bloquea a quien no sea admin).

**`seed`:** no necesita argumentos, así que no hace falta el patrón `tmp()`: elegí `seed` directamente en el selector de funciones y tocá **Ejecutar**. Es idempotente, correrla dos veces no crea datos duplicados.

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

## Blog de ejemplo

Además del framework, el repo trae un blog de ejemplo completo: posts con estado (`draft`/`published`/`archived`) y visibilidad (`public`/`members`/`private`), comentarios, tags, roles y archivos de Drive. Es la demostración de cómo construir algo real arriba del framework; podés usarlo como base o borrarlo. La referencia completa de su API JSON (`/api/v1/...`, envelope, códigos de error, límites, ejemplos con curl) vive en [`docs/api.md`](docs/api.md).

### Roles

| Rol | Puede |
|---|---|
| `reader` | Leer contenido público y de miembros, comentar en posts publicados que puede ver |
| `author` | Todo lo de `reader`, más crear/editar/borrar sus propios posts y subir/borrar su propia media |
| `admin` | Todo: cualquier post, cualquier usuario (rol, habilitar/deshabilitar), crear tags |

### Estados y visibilidad

Un post tiene dos campos independientes:

- **`status`**: `draft` → `published` (fija la fecha de publicación la primera vez) → `archived` → `draft`, o `published` → `draft`. Cualquier otra transición se rechaza.
- **`visibility`**: `public` (cualquiera), `members` (cualquier usuario logueado) o `private` (solo el autor y los admins).

Solo se puede leer un post ajeno cuando está `published` **y** su visibilidad lo permite; el autor y los admins siempre ven sus propios posts/todos los posts, sin importar el estado.

### Guía de usuario (sin terminal)

Todo esto se hace desde el navegador, sin tocar la línea de comandos:

1. **Registrarse**: `/register`. Queda logueado como `reader`.
2. **Convertirse en autor**: un admin entra a `/admin/users`, busca el usuario y le cambia el rol a `author`.
3. **Escribir y publicar**: con rol `author` (o `admin`), aparece "Dashboard" en la navegación. Desde `/dashboard` → "New post" se completa título, resumen, cuerpo, visibilidad y tags; el post arranca en `draft`. Desde el editor de un post existente se cambia el estado (solo a las transiciones permitidas desde el estado actual).
4. **Subir archivos**: en el editor de un post ya creado, el panel de media deja elegir un archivo (imágenes, video, PDF, docx o zip, hasta 2 MB) y lo sube.
5. **Comentar**: en `/posts/:slug`, cualquier usuario logueado ve el formulario de comentarios si el post está publicado y es visible para él.
6. **Páginas de admin**: `/admin/users` (cambiar rol, habilitar/deshabilitar) y `/admin/tags` (crear tags nuevos).

Los únicos pasos que siguen siendo de terminal/editor son los de configuración inicial (`migrate`, `seed`, crear el primer admin, habilitar el scope de Drive): son pasos de puesta en marcha del proyecto, no del flujo normal de un usuario.

## Primer admin

El registro público (`/register`, `POST /api/v1/auth/register`) siempre crea un usuario `reader`: nunca otorga `admin`, y tener tu email en `ADMIN_EMAILS` tampoco te hace admin dentro de la app (esa Script Property solo protege las funciones globales owner-only — `migrate`, `createUser`, `seed` — no es un rol de la aplicación). El primer admin se crea por una de estas dos vías:

- **Desde la terminal**, con `clasp run` ya configurado (ver "Ejecutar `migrate`, `createUser` y `seed` desde la terminal"):

  ```bash
  clasp run createUser -p '["vos@ejemplo.com", "un-password-largo", "tu-username", "admin"]'
  ```

- **Desde el editor**, sin configurar `clasp run`, con el patrón `tmp()` ya documentado más arriba ("Alternativa sin Google Cloud: correr las funciones desde el editor"): una función temporal que llama a `createUser(email, password, username, 'admin')`, ejecutarla una vez y borrarla.

Los dos caminos exigen tener tu email en `ADMIN_EMAILS` (`assertAdmin()` lo chequea). Una vez que existe un admin, el resto de los roles se maneja desde `/admin/users`, sin volver a la terminal.

## Seeders

Un seeder llena datos iniciales de forma idempotente: correrlo dos veces no duplica nada (usa `Model.firstOrCreate` por debajo). El único seeder de ejemplo (`src/app/seeders/tag.seeder.ts`) crea las tags `General`, `Tutorial`, `Apps Script`, `TypeScript`, `Google Sheets` y `Announcements`.

Correrlo:

```bash
pnpm seed
```

o, desde el editor de Apps Script, elegí `seed` en el selector de funciones y tocá **Ejecutar** (no necesita argumentos). Tu email tiene que estar en `ADMIN_EMAILS`. La respuesta es un reporte por seeder: `[{ name, created, existing }]`.

Para agregar un seeder propio, implementá `Seeder` (`{ name, run(ctx) }` en `src/core/seeder.ts`, con `ctx = { adapter, lock, now }`) usando `firstOrCreate` para que sea idempotente, y suma lo a la lista en `src/app/seeders/index.ts`.

## Permisos (`oauthScopes`)

`src/appsscript.json` fija explícitamente los scopes de OAuth que la app pide al autorizarse, en vez de dejar que Apps Script los infiera del código en cada deploy:

```json
"oauthScopes": [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/script.scriptapp",
  "https://www.googleapis.com/auth/script.container.ui"
]
```

| Scope | Para qué lo usa esta app |
|---|---|
| `spreadsheets` | Todo el modelo de datos vive en Sheets (`SpreadsheetApp`, el `Sheets` advanced service) |
| `drive` | Guardar, compartir y leer los archivos de media de los posts (`DriveApp`) |
| `userinfo.email` | `Session.getActiveUser().getEmail()`, para `assertAdmin()` |
| `script.scriptapp` | `ScriptApp.getService().getUrl()`, para armar los links entre vistas |
| `script.container.ui` | Acceso a la UI del contenedor (menús, etc.) |

**Por qué fijarlos a mano:** si dejás que Apps Script infiera los scopes, un deploy nuevo puede pedir scopes distintos sin que lo notes, y el manifest remoto queda desincronizado de `src/appsscript.json` (ver "El freno de seguridad `Skipping push.`"). Pinándolos, el manifest es explícito y versionado.

**Agregar un servicio de Google nuevo (por ejemplo, Gmail) exige agregar su scope aquí.** El flujo guiado:

1. Escribí el código que usa el servicio nuevo.
2. `pnpm run deploy --push-only` para subir a `/dev` sin redesplegar.
3. En el editor (`pnpm open`): **Configuración del proyecto → Mostrar el archivo de manifiesto**, para ver qué scopes detectó Apps Script al correr el código nuevo.
4. Agregá el scope que falta a `oauthScopes` en `src/appsscript.json`.
5. `pnpm run deploy --force` (manifest cambiado a propósito, ver "El freno de seguridad `Skipping push.`").
6. Volvé a abrir la web app: Google te va a pedir reautorizar, porque el set de permisos cambió.

## Archivos en Drive

Los archivos que suben los posts (imágenes, video, PDF, docx, zip) se guardan en una carpeta de Google Drive, identificada por la Script Property `MEDIA_FOLDER_ID`.

- **Creá la carpeta** en tu Drive y copiá su ID desde la URL (`https://drive.google.com/drive/folders/<ID>`) a la Script Property `MEDIA_FOLDER_ID`.
- **Comportamiento de compartido:** un archivo de un post `published` + `public` se comparte "cualquiera con el enlace"; cualquier otro estado lo deja privado. Esto se re-sincroniza cada vez que cambia el `status`/`visibility` del post, o cuando se borra (ver `docs/api.md` → "Media").
- **Riesgo del scope completo de Drive:** el scope `drive` (no `drive.file`) le da al script acceso a *todo* el Drive de la cuenta que lo autoriza, no solo a `MEDIA_FOLDER_ID`. La mitigación de este proyecto es de diseño: todas las operaciones de archivo pasan por `StorageAdapter` y solo usan ids guardados en la sheet `media`, nunca un id arbitrario del Drive del usuario. Aun así, **para una demo pública se recomienda una cuenta de Google dedicada** (no la cuenta personal del dueño), separada del resto de tus archivos.
- `setSharing(ANYONE_WITH_LINK)` puede estar bloqueado por política de administrador en cuentas de Google Workspace; las cuentas Gmail personales lo permiten sin restricciones.

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
