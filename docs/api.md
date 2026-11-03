# API (`/api/v1/...`)

Referencia completa de la API JSON del blog de ejemplo. Para la guía de usuario (UI sin terminal), ver el `README.md`.

## Transporte

Apps Script no expone rutas reales en la URL de la web app. El `event` de `doGet`/`doPost` sí trae `pathInfo` (todo lo que sigue a `/exec/`), pero ese camino redirige a cualquier cliente anónimo a la pantalla de inicio de sesión de Google antes de que el script llegue a ejecutarse (verificado contra una implementación `ANYONE_ANONYMOUS`: `GET /exec` da 200 anónimo, `GET /exec/api/v1/ping` redirige a `accounts.google.com`). Por eso toda la API y todas las vistas se piden con la ruta en el parámetro `route`:

```
$APP_URL?route=/api/v1/posts
```

`$APP_URL` es la URL `.../exec` de tu implementación (no la pongas en texto plano en ningún lado versionado).

Dos reglas de transporte, siempre:

- **`curl -L` y nunca `-X POST`**: Apps Script responde a un `POST` con un `302` hacia `script.googleusercontent.com`, donde está el JSON, y ese segundo pedido tiene que ser `GET`. Con `-d` (sin `-X`), `curl` hace el `POST` y, al seguir el redirect con `-L`, pasa a `GET` solo. Si agregás `-X POST`, `curl` fuerza `POST` también en el redirect y el pedido falla.
- **`-H 'Content-Type: text/plain'`**: es lo que tiene que mandar un navegador desde otro origen. Con `application/json` el navegador hace antes un preflight `OPTIONS`, y Apps Script no puede responderlo. `curl` no hace preflight, así que ahí el header no cambia nada, pero los ejemplos lo usan para que valgan igual desde un `fetch`. El cuerpo sigue siendo JSON y el servidor lo parsea igual.

## Envelope JSON

Toda respuesta de `/api/v1/...` es uno de estos dos sobres.

Éxito:

```json
{ "ok": true, "status": 200, "data": { "...": "..." } }
```

Con paginación, además de `data` viene `meta`:

```json
{ "ok": true, "status": 200, "data": [], "meta": { "page": 1, "perPage": 10, "total": 0, "pages": 0 } }
```

Error:

```json
{ "ok": false, "status": 422, "error": { "code": "VALIDATION_ERROR", "message": "Validation error", "details": { "title": "..." } } }
```

`details` es opcional y solo aparece cuando el error lo necesita (por ejemplo, validación por campo).

**Importante:** Apps Script siempre responde HTTP 200 al navegador; no puede elegir el código HTTP de la respuesta. El `status` de arriba es el código de la API dentro del envelope, no el código HTTP real. El cliente (curl, `App.call`, etc.) tiene que leer `ok`/`status`/`error` del cuerpo, nunca el código HTTP de la conexión.

## Códigos de error

| `code` | `status` | Cuándo |
|---|---|---|
| `VALIDATION_ERROR` | 422 | Un campo del body no cumple sus reglas; `details` trae el detalle por campo |
| `INVALID_TRANSITION` | 422 | Un `status` de post pedido no es una transición válida desde el estado actual |
| `UNAUTHENTICATED` | 401 | Falta token, token inválido/expirado, o el usuario del token está deshabilitado o fue borrado |
| `FORBIDDEN` | 403 | El usuario autenticado no tiene permiso para la acción (rol, no ser el dueño, etc.) |
| `NOT_FOUND` | 404 | El recurso no existe, o existe pero no es visible para el caller (nunca se distingue, para no filtrar existencia) |
| `METHOD_NOT_ALLOWED` | 405 | La ruta existe para otro método, o un `_method` inválido |
| `CONFLICT` | 409 | Email/username/slug/tag duplicados |
| `PAYLOAD_TOO_LARGE` | 413 | El archivo subido (decodificado de base64) supera los 2 MB |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | MIME type no permitido, o se pidió el contenido base64 de un video protegido (no soportado) |
| `STORAGE_SYNC_FAILED` | 502 | Al cambiar el estado/visibilidad de un post, Drive falló al (des)compartir alguno de sus archivos |
| `BUSY` | 503 | No se pudo adquirir el lock del script (`LockService`) dentro del tiempo de espera |
| `INTERNAL` | 500 | Cualquier error no controlado; el mensaje es siempre genérico, nunca el error original ni un stack |

## Method override (`_method`)

El router solo entiende `GET` y `POST` reales (Apps Script solo tiene `doGet`/`doPost`). Para `PUT`, `PATCH` y `DELETE`, mandá un `POST` con `_method` en el body:

```json
{ "_method": "PATCH", "title": "Nuevo título" }
```

- Solo se lee `_method` en un `POST`; en un `GET` se ignora (ni el body ni el query string).
- El valor es case-insensitive (`"patch"`, `"PATCH"`) y debe ser `GET`, `PUT`, `PATCH` o `DELETE`; cualquier otro valor → 405.
- Antes de llegar al handler, `_method` se quita del body: el handler nunca lo ve.

## Autenticación

No hay header `Authorization`. Apps Script no expone headers de request personalizados al script (el `event` de `doGet`/`doPost` no los trae), así que el token viaja siempre en el **body**, nunca en query params ni headers:

```json
{ "token": "eyJ..." }
```

### Registro y login

```
POST /api/v1/auth/register   { email, password, username } → 201 { token, user }
POST /api/v1/auth/login      { email, password }            → 200 { token }
```

- El registro siempre crea un usuario `reader` (un `role` en el body se ignora).
- Login con email inexistente y login con password incorrecto devuelven el mismo error (`UNAUTHENTICATED`, mismo mensaje) y hacen el mismo trabajo de hashing, para no revelar qué emails existen por tiempo de respuesta.
- Un usuario deshabilitado recibe el mismo error genérico al intentar loguearse.

### Lecturas protegidas por POST

Un `GET` nunca lleva token (solo ve contenido público). Para leer contenido que requiere autenticación, el cliente manda un `POST` con `_method: "GET"` y el token en el mismo body:

```json
{ "_method": "GET", "token": "eyJ..." }
```

Esa petición se despacha a la misma ruta `GET`, con el `request.user` ya resuelto. Un token presente pero inválido siempre da 401 — nunca se degrada silenciosamente a una respuesta anónima. Un token solo en el query string (`?token=...`) nunca se lee: el caller queda anónimo.

Rutas marcadas `GET*` en la tabla de abajo son alcanzables así.

## Endpoints

Todas las rutas van precedidas por `?route=` sobre `$APP_URL`.

| Método | Ruta | Auth | Body / filtros |
|---|---|---|---|
| POST | `/api/v1/auth/register` | — | `{ email, password, username }` → reader + `{ token, user }` |
| POST | `/api/v1/auth/login` | — | `{ email, password }` → `{ token }` |
| GET* | `/api/v1/auth/me` | requerida | usuario actual (sin `password`) |
| GET | `/api/v1/posts` | opcional | `?page`, `?perPage`, `?tag` (slug), `?author` (id), `?status` (solo visible para el dueño/admin) |
| GET | `/api/v1/posts/:idOrSlug` | opcional | numérico → busca por id; si no, por slug |
| POST | `/api/v1/posts` | author/admin | `{ title, excerpt?, body?, visibility?, slug?, tags? }` → crea en `draft` |
| PATCH | `/api/v1/posts/:id` | dueño/admin | mismos campos + `status` (transición) |
| DELETE | `/api/v1/posts/:id` | dueño/admin | soft delete + desincroniza media |
| GET | `/api/v1/posts/:idOrSlug/comments` | opcional | `?page`, `?perPage` |
| POST | `/api/v1/posts/:idOrSlug/comments` | requerida | `{ body }` |
| DELETE | `/api/v1/comments/:id` | autor del comentario / autor del post / admin | — |
| GET | `/api/v1/tags` | — | lista completa `{ id, name, slug }` |
| POST | `/api/v1/tags` | admin | `{ name }` → slug generado |
| GET* | `/api/v1/users` | admin | `?page`, `?perPage` |
| PATCH | `/api/v1/users/:id` | admin | `{ role?, disabled? }`; no sobre uno mismo |
| GET | `/api/v1/posts/:idOrSlug/media` | opcional | lista de archivos del post |
| POST | `/api/v1/posts/:idOrSlug/media` | dueño/admin | `{ name, mimeType, data(base64) }` |
| GET | `/api/v1/media/:id` | opcional | `?download=true` para pedir el base64 si no es público |
| DELETE | `/api/v1/media/:id` | dueño/admin | borra en Drive (trash) + soft delete de la fila |

`GET*` = también alcanzable como `POST` + `_method: "GET"` con token en el body (ver arriba).

## Límites

| Campo | Límite |
|---|---|
| `title` (post) | 1–200 caracteres |
| `excerpt` (post) | hasta 300 caracteres |
| `body` (post) | hasta 50.000 caracteres (límite de celda de Sheets) |
| `body` (comentario) | 1–2.000 caracteres |
| `password` | 8–256 caracteres |
| `perPage` (cualquier listado paginado) | 1–50 (default varía por endpoint: 10 en posts/usuarios, 20 en comentarios) |
| Subida de archivo | hasta 2 MB (decodificado de base64) |
| Archivos por post | hasta 20 |
| MIME types permitidos | `image/png`, `image/jpeg`, `image/gif`, `image/webp`, `video/mp4`, `video/webm`, `application/pdf`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document` (docx), `application/zip` |

Cualquier otro valor en estos campos → `VALIDATION_ERROR` (422), excepto MIME type no permitido → `UNSUPPORTED_MEDIA_TYPE` (415) y tamaño excedido → `PAYLOAD_TOO_LARGE` (413, se chequea antes de decodificar el base64 completo).

## Visibilidad (status × visibility × rol)

Cada post tiene dos campos independientes:

- `status`: `draft` | `published` | `archived`. Transiciones permitidas: `draft→published` (fija `published_at` la primera vez, nunca se sobreescribe), `published→archived`, `archived→draft`, `published→draft`. Cualquier otra → 422 `INVALID_TRANSITION`.
- `visibility`: `public` (cualquiera) | `members` (cualquier usuario logueado) | `private` (autor + admin).

Regla de lectura (`canView`):

- Un post borrado nunca es visible, para nadie.
- Un admin ve todo.
- El dueño (autor) ve siempre su propio post, sin importar `status`/`visibility`.
- Para cualquier otro caller, el post solo es visible si `status = published`, y además: `public` → cualquiera (incluido anónimo); `members` → cualquier usuario logueado; `private` → nadie más que el dueño/admin.

Un post no visible siempre da 404 (nunca 403), para no filtrar si existe.

Comentarios: solo se puede comentar un post visible y `published`; se borran por el autor del comentario, el autor del post o un admin. Sin moderación.

## Media: links públicos vs. base64 protegido

- Un archivo de un post **público y publicado** se comparte "cualquiera con el enlace" en Drive y la API devuelve links directos: `url`, `downloadUrl` y, según el tipo, `imageUrl` (thumbnail, para usar en `<img src>`) o `embedUrl` (solo video, para iframe).
- Un archivo de cualquier otro post (`draft`, `archived`, `members`, `private`) nunca se comparte en Drive. Para leerlo, un caller autorizado (dueño/admin, o cualquier logueado si `members`) pide `GET /api/v1/media/:id?download=true` (o `_method: "GET"` + `download: true` + token) y recibe el contenido en `data` (base64), no un link.
- **Video protegido no está soportado**: pedir `download=true` sobre un video no público da 415 `UNSUPPORTED_MEDIA_TYPE`.
- Cada vez que un post cambia de `status`/`visibility`, o se borra, sus archivos se re-sincronizan con Drive (se comparten o se dejan de compartir según corresponda).
- Si Drive falla al (des)compartir alguno de los archivos durante esa sincronización, la API responde 502 `STORAGE_SYNC_FAILED`: el cambio al post **ya se guardó**, pero algún archivo quedó con el estado de compartido anterior. El mensaje lo dice explícitamente. Para reintentar, repetí el cambio que lo disparó (en la UI del editor, el botón "Retry file sync" hace un `PATCH` vacío sobre el post, que vuelve a disparar la sincronización sin cambiar ningún otro campo).

## Ejemplos con curl

Todos usan `$APP_URL` como placeholder de tu URL `.../exec`, `-L` para seguir el 302, `-d` sin `-X POST` (ver Transporte) y `Content-Type: text/plain`.

### Listar posts, sin loguearse (solo ve público)

```bash
curl -s -L "$APP_URL?route=/api/v1/posts&tag=tutorial&page=1"
```

### Registrarse

```bash
curl -s -L -H 'Content-Type: text/plain' \
  -d '{"email":"ana@example.com","password":"un-password-largo","username":"ana"}' \
  "$APP_URL?route=/api/v1/auth/register"
```

### Login

```bash
curl -s -L -H 'Content-Type: text/plain' \
  -d '{"email":"ana@example.com","password":"un-password-largo"}' \
  "$APP_URL?route=/api/v1/auth/login"
```

Guardá el `token` de la respuesta en una variable:

```bash
TOKEN=$(curl -s -L -H 'Content-Type: text/plain' \
  -d '{"email":"ana@example.com","password":"un-password-largo"}' \
  "$APP_URL?route=/api/v1/auth/login" | node -pe 'JSON.parse(require("fs").readFileSync(0)).data.token')
```

### Lectura protegida (GET vía POST + `_method`)

```bash
curl -s -L -H 'Content-Type: text/plain' \
  -d "{\"_method\":\"GET\",\"token\":\"$TOKEN\",\"status\":\"draft\"}" \
  "$APP_URL?route=/api/v1/posts"
```

### Crear un post

```bash
curl -s -L -H 'Content-Type: text/plain' \
  -d "{\"token\":\"$TOKEN\",\"title\":\"Mi primer post\",\"excerpt\":\"Un resumen corto\",\"body\":\"Primer párrafo.\n\nSegundo párrafo.\",\"visibility\":\"public\"}" \
  "$APP_URL?route=/api/v1/posts"
```

Guardá el `id` de la respuesta en `POST_ID`.

### Publicarlo

```bash
curl -s -L -H 'Content-Type: text/plain' \
  -d "{\"_method\":\"PATCH\",\"token\":\"$TOKEN\",\"status\":\"published\"}" \
  "$APP_URL?route=/api/v1/posts/$POST_ID"
```

### Subir un archivo chico desde la shell

El archivo va embebido en el JSON como base64, sin el prefijo `data:...;base64,`. Un archivo de 2 MB son ~2,7 MB de base64: eso supera el límite de largo de un argumento en la shell (`ARG_MAX`), así que el JSON se arma en un archivo y se manda con `--data-binary @`:

```bash
node -e 'const fs = require("fs"); fs.writeFileSync("upload.json", JSON.stringify({ token: process.argv[1], name: "logo.png", mimeType: "image/png", data: fs.readFileSync("logo.png").toString("base64") }))' "$TOKEN"
curl -s -L -H 'Content-Type: text/plain' \
  --data-binary @upload.json \
  "$APP_URL?route=/api/v1/posts/$POST_ID/media"
rm upload.json
```

### Comentar

```bash
curl -s -L -H 'Content-Type: text/plain' \
  -d "{\"token\":\"$TOKEN\",\"body\":\"Buen post!\"}" \
  "$APP_URL?route=/api/v1/posts/$POST_ID/comments"
```
