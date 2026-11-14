# Correcciones de seguridad — Cuidarte+ (rama `mejoras-seguridad`)

Fecha de las pruebas: 2026-11-14. Entorno: Docker Desktop (Windows 11), `docker compose up -d --build` desde `CodigoFuenteB/`, API en `http://localhost:4444`, frontend en `http://localhost:3333`, usuarios semilla `admin/admin`, `medico/medico`, `paciente/paciente`.

Todas las pruebas "Antes" se ejecutaron contra el código de `main` (commit `7255085`) y las "Después" contra esta rama, **con los mismos comandos** (script [`CodigoFuenteB/pruebas-seguridad.sh`](CodigoFuenteB/pruebas-seguridad.sh)). Las pruebas "Después" se hicieron con un volumen de base de datos nuevo (`docker compose down -v`), salvo la prueba de migración (H1-b), que se hizo sobre el volumen antiguo.

## Tabla resumen

| # | Hallazgo | Archivo | Antes | Después | OWASP | Ley chilena |
|---|---|---|---|---|---|---|
| H1 | Contraseñas en texto plano | `BACKEND/src/routes/auth.js`, `routes/users.js`, `sql/dump-cuidarteplus.sql` | En BD: `admin \| admin`, `prueba_antes \| Secreta123`. Login compara `user.contrasena !== password` | En BD: `admin \| $2b$12$Dg6x…`, `prueba_despues \| $2b$12$B/Cm…`. Login con `bcrypt.compare`; `admin/admin` → **HTTP 200** | A02 Fallas criptográficas · A07 Fallas de identificación y autenticación | Ley 19.628, art. 11 (deber de cuidado de datos personales) |
| H2 | Secreto JWT y contraseña de BD con valor por defecto | `src/routes/*.js`, `src/db.js`, `docker-compose.yml`, `README.md` | Token forjado con el secreto por defecto de compose → `GET /auditoria` **HTTP 200** con todos los registros. Backend sin variables arranca: `escuchando en puerto 3000` | Mismo token forjado → **HTTP 401**. Backend sin `JWT_SECRET` → `exit=1` con mensaje claro; compose sin `.env` → se niega a arrancar | A02 Fallas criptográficas (también A05) | Ley 19.628, art. 11 |
| H3 | Control de acceso incompleto | `routes/users.js`, `routes/roles.js`, `routes/pacientes.js`, `middleware/auth.js` (nuevo) | `DELETE /usuarios/4` sin token → **200** `{"deleted":true}`. `POST /roles` y `DELETE /roles/4` sin token → **201/200**. `GET /pacientes/buscar/rut/16789456-K` sin token → **200** con la ficha completa | Sin token → **401**; con token de paciente → **403**; búsqueda por RUT solo médico/admin (médico → 200) | A01 Pérdida de control de acceso | Ley 20.584, arts. 12–13 (confidencialidad de la ficha clínica) · Ley 19.628 |
| H4 | Fuga de detalles internos en errores 500 | `middleware/validate.js`, todas las rutas en `src/routes/` | `GET /usuarios/abc` → 500 `"glosa":"invalid input syntax for type bigint: \"abc\""` (igual en `/pacientes/abc`, `PUT /examenes/abc`) | 500 `"glosa":"Error interno"`; el detalle queda solo en `console.error` del servidor | A05 Configuración de seguridad incorrecta | Ley 19.628, art. 11 |
| H5 | CORS abierto y sin cabeceras de seguridad | `BACKEND/src/app.js`, `FRONTEND/nginx.conf` | API: `Access-Control-Allow-Origin: *`, `X-Powered-By: Express`, sin CSP. nginx: solo `Server: nginx/1.31.8` | API: `Access-Control-Allow-Origin: http://localhost:3333`, CSP, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, sin `X-Powered-By`. nginx: CSP, `nosniff`, `DENY`, `Referrer-Policy`, sin versión | A05 Configuración de seguridad incorrecta | Ley 19.628, art. 11 |
| H6 | Sin límite de intentos de login | `routes/auth.js` | 12 intentos fallidos: `401 ×12`, sin cabeceras `RateLimit` | 12 intentos fallidos: `401 401 401 401 429 429 …`; `RateLimit-Policy: 5;w=900`, `Retry-After` | A07 Fallas de identificación y autenticación · ASVS 2.2.1 | Ley 19.628, art. 11 · Ley 21.459 (delitos informáticos: acceso ilícito) |
| H3+ | (adicional) Cualquier usuario autenticado puede crear usuarios con rol admin | `routes/users.js` (`POST /usuarios`) | Solo exigía token válido (verificado **por lectura de código**, no se ejecutó en "Antes") | Paciente → **403**; admin → 201 | A01 | Ley 20.584 · Ley 19.628 |

---

## Detalle por hallazgo

### H1 — Contraseñas en texto plano (bcrypt)

**Cambio:** nuevo módulo `src/utils/passwords.js` (bcrypt, cost 12, librería `bcryptjs`: mismo algoritmo y formato `$2b$` que `bcrypt`, pero sin compilación nativa en `node:18-alpine`).
- Login: `verifyPassword()` → `bcrypt.compare`. Si el usuario no existe, se compara contra un hash ficticio para no revelar por tiempo de respuesta si el usuario existe.
- Registro (`/autenticacion/registro`): `bcrypt.hash` antes del `INSERT`.
- `POST /usuarios` y `PUT /usuarios/:id` también reciben la contraseña (campo `contrasena_hash`) y ahora la hashean; sin esto, los usuarios creados por el admin o un cambio de contraseña habrían dejado de poder iniciar sesión.
- Usuarios semilla: `dump-cuidarteplus.sql` ahora tiene los hashes bcrypt de `admin`, `medico` y `paciente` (las contraseñas en claro no cambian). `init.sql` **no contiene usuarios** (solo roles) y no lo usa docker-compose, así que no requirió cambios.
- Migración al arrancar (`migratePlaintextPasswords`): hashea cualquier contraseña que siga en texto plano. Cubre volúmenes de BD creados antes de este cambio.

**Antes**
```
$ curl -X POST localhost:4444/autenticacion/login -d '{"nombre_usuario":"admin","password":"admin"}'
HTTP 200  {"token":"eyJhbGciOiJIUzI1NiIs...
$ docker exec <postgres> psql -c "SELECT nombre_usuario || ' | ' || contrasena FROM usuarios"
admin | admin
medico | medico
paciente | paciente
prueba_antes | Secreta123
```
**Después (volumen nuevo)**
```
POST /autenticacion/login admin/admin        -> HTTP 200 {"token":...}
POST /autenticacion/login medico/medico      -> HTTP 200
POST /autenticacion/login paciente/paciente  -> HTTP 200
POST /autenticacion/login admin/incorrecta   -> HTTP 401 {"error":"Credenciales inválidas"}
POST /autenticacion/registro prueba_despues  -> HTTP 201 ; login posterior -> HTTP 200
admin | $2b$12$Dg6xkYeXIp7DQdJ6fXHbye7sq8YbMjd9hiMY8bt3wDqlXIAn3QJUS
medico | $2b$12$RfczwD5nnnBceKPAOaq16.qJoTYZGnAssWuGoCLGqQnEjsCb1CJAG
paciente | $2b$12$0EovxFz2ycaHwirR8gDUc.UTGWxRK.pm3yZspgmyN/N3lgkZ7j6g.
prueba_despues | $2b$12$B/CmLMxnq.0xXSsYr3X0TeS4sa2t0Sdof1BELfc22jmLjE5KgNgZ6
```
**H1-b — Migración sobre el volumen antiguo (con contraseñas en texto plano)**
```
log backend: [seguridad] 3 contraseña(s) en texto plano migradas a bcrypt
POST /autenticacion/login admin/admin -> HTTP 200
admin | $2b$12$j8WlQWdSRuUYM...
```
**Flujos que dependen de contraseñas (después)**
```
POST /usuarios (admin) medico2/Medico123   -> 201 ; login medico2 -> 200 ; en BD: $2b$12$...
PUT /usuarios/3 (paciente) nueva clave      -> 200 ; login paciente/NuevaClave1 -> 200
```

### H2 — Secreto JWT / URL de BD con valores por defecto

**Cambio:** nuevo `src/config.js` que centraliza la lectura de `JWT_SECRET`, `DATABASE_URL`, `FRONTEND_URL` y `PORT`. `JWT_SECRET` (mín. 32 caracteres) y `DATABASE_URL` son obligatorias: si faltan, el proceso termina con `exit 1` y un mensaje claro. Se quitaron `|| "inseguro"` de las 7 rutas y `alone15` de `db.js`. En `docker-compose.yml` se quitó el valor por defecto `your-secret-key-change-in-production` (se usa `${JWT_SECRET:?…}`). Se eliminó el `JWT_SECRET` escrito en `CodigoFuenteB/README.md` y se agregaron `.env.example` (raíz de `CodigoFuenteB/` y `BACKEND/`) sin valores reales y un `.gitignore` que excluye `.env`.

**Antes**
```
# Token HS256 forjado con el secreto por defecto de docker-compose, payload {usuarioId:1,nombreUsuario:"admin"}
GET /auditoria (token forjado 'your-secret-key-change-in-production') -> HTTP 200 [{"id":"9","usuario_id":"3","accion":"LOGIN..."
GET /auditoria (token forjado 'inseguro')                             -> HTTP 401   (compose sí definía un valor, el del código no se usaba)
$ docker run <imagen-backend>      # sin ninguna variable de entorno
estado: running exit=0
cuidarteplus API escuchando en puerto 3000
```
**Después**
```
GET /auditoria (token forjado 'your-secret-key-change-in-production') -> HTTP 401 {"error":"No autorizado","glosa":"Token inválido"}
GET /auditoria (token forjado 'inseguro')                             -> HTTP 401
$ docker compose --env-file <vacío> config
exit=1  required variable JWT_SECRET is missing a value: Defina JWT_SECRET en el archivo .env (ver .env.example)
$ docker run <imagen-backend>      # sin variables
estado: exited exit=1
[config] Falta la variable de entorno obligatoria JWT_SECRET. Defínela en el entorno o en el archivo .env (ver .env.example).
$ docker run -e JWT_SECRET=<32+ chars> <imagen-backend>   # sin DATABASE_URL
estado: exited exit=1
[config] Falta la variable de entorno obligatoria DATABASE_URL. ...
```

### H3 — Control de acceso incompleto

**Cambio:** nuevo middleware `src/middleware/auth.js` → `requireRole([...])` (verifica el JWT, consulta los roles en la BD —no confía en los roles del token— y responde 401/403). Matriz aplicada:

| Endpoint | Antes | Después |
|---|---|---|
| `DELETE /usuarios/:id` | sin token ni rol | admin |
| `POST /usuarios` | cualquier token válido | admin (adicional) |
| `POST /roles`, `PUT /roles/:id`, `DELETE /roles/:id` | sin token ni rol | admin (POST/PUT adicionales: mismo archivo y mismo defecto) |
| `GET /roles` | público | sin cambio (lo usan los formularios; solo lista nombres de roles) |
| `GET /pacientes/buscar/rut/:rut` | público | médico, admin |
| `GET /pacientes/:id` | ya exigía token: médico/admin todo; paciente solo su ficha | sin cambio (ver nota) |
| `GET /examenes` | ya exigía token: médico/admin todo; paciente solo los suyos | sin cambio (ver nota) |
| `GET /documentos/:id` | ya exigía token: médico/admin; paciente solo los suyos | sin cambio (ver nota) |

> **Nota:** al probar, `GET /pacientes/:id`, `GET /examenes` y `GET /documentos/:id` **ya** devolvían 401 sin token y 403 a un paciente que pide datos ajenos (ver evidencia "Antes"). No se restringieron a solo médico/admin porque el frontend usa esos endpoints para que el paciente vea **sus propios** datos (`MisResultados.jsx`, `UsuarioForm.jsx`, `Home.jsx`); quitar ese acceso rompería la lógica de negocio.

También se corrigió que la auditoría de `DELETE /usuarios` y de `/roles` insertaba `nombreUsuario` (texto) en la columna `usuario_id` (BIGINT), lo que hacía fallar la petición con 500 cuando sí había token.

**Antes**
```
DELETE /usuarios/4 (sin token)                                -> HTTP 200 {"deleted":true}
POST   /roles {"nombre":"rol_temp_antes"} (sin token)         -> HTTP 201 {"id":"4","nombre":"rol_temp_antes"}
DELETE /roles/4 (sin token)                                   -> HTTP 200 {"deleted":true}
GET /pacientes/buscar/rut/16789456-K (sin token)              -> HTTP 200 {"id":"2","rut":"16789456-K","primer_nombre":"María",...ficha completa}
GET /pacientes/buscar/rut/16789456-K (paciente, RUT ajeno)    -> HTTP 200 {...ficha completa}
GET /pacientes/2 (sin token) -> 401 ; (paciente, ajeno) -> 403 ; (médico) -> 200
GET /examenes (sin token) -> 401 ; GET /documentos/1 (sin token) -> 401
```
**Después**
```
DELETE /usuarios/4 (sin token)                                -> HTTP 401 {"error":"No autorizado","glosa":"Token inválido"}
DELETE /usuarios/4 (paciente)                                 -> HTTP 403 {"error":"No autorizado","glosa":"No tiene permisos para realizar esta acción"}
POST   /roles (sin token)                                     -> HTTP 401
DELETE /roles/999 (sin token) -> 401 ; (paciente) -> 403
GET /pacientes/buscar/rut/16789456-K (sin token)              -> HTTP 401
GET /pacientes/buscar/rut/16789456-K (paciente)               -> HTTP 403
GET /pacientes/buscar/rut/16789456-K (médico)                 -> HTTP 200
GET /pacientes/2 (sin token) -> 401 ; (paciente, ajeno) -> 403 ; (médico) -> 200 ; GET /pacientes/1 (paciente, propio) -> 200
POST /usuarios (paciente, rol_id=1)                           -> HTTP 403
DELETE /usuarios/5 (admin)                                    -> HTTP 200 ; auditoría: "1 | USUARIOS_ELIMINAR: eliminó usuario ID 5"
```

### H4 — Fuga de detalles en errores 500

**Cambio:** `validate.js` y **todas** las rutas (`auth`, `users`, `roles`, `pacientes`, `examenes`, `documentos`, `audit`, `tipo-examen`) devolvían `err.message` en `glosa`. Ahora devuelven `"Error interno"`; el detalle se sigue registrando con `console.error` en el servidor.

```
ANTES   GET /usuarios/abc (admin)     -> HTTP 500 {"error":"Error al obtener usuario","glosa":"invalid input syntax for type bigint: \"abc\""}
        GET /pacientes/abc (admin)    -> HTTP 500 {...,"glosa":"invalid input syntax for type bigint: \"abc\""}
        PUT /examenes/abc (médico)    -> HTTP 500 {...,"glosa":"invalid input syntax for type bigint: \"abc\""}
DESPUÉS GET /usuarios/abc (admin)     -> HTTP 500 {"error":"Error al obtener usuario","glosa":"Error interno"}
        GET /pacientes/abc (admin)    -> HTTP 500 {"error":"Error al obtener paciente","glosa":"Error interno"}
        PUT /examenes/abc (médico)    -> HTTP 500 {"error":"Error al actualizar examen médico","glosa":"Error interno"}
```
(Durante la primera prueba fallida, con la BD vacía, el login devolvía incluso `relation "usuarios" does not exist`, otra muestra de la misma fuga.)

### H5 — CORS y cabeceras

**Cambio:** `app.js` agrega `helmet` (con `upgrade-insecure-requests` desactivado porque el entorno local es HTTP y si no Swagger `/docs` dejaría de cargar) y `cors({ origin: FRONTEND_URL })` (por defecto `http://localhost:3333`). `nginx.conf` agrega `Content-Security-Policy`, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` (con `always`, y repetidas en `location /static` porque `add_header` en un `location` reemplaza las del `server`) y `server_tokens off`.

```
ANTES  API  (Origin: http://evil.example) -> X-Powered-By: Express ; Access-Control-Allow-Origin: *
       nginx GET /                         -> Server: nginx/1.31.8   (sin cabeceras de seguridad)
DESPUÉS API (Origin: http://evil.example)  -> Access-Control-Allow-Origin: http://localhost:3333   (no coincide con el origen → el navegador bloquea)
       Content-Security-Policy: default-src 'self';base-uri 'self';font-src 'self' https: data:;form-action 'self';frame-ancestors 'self';img-src 'self' data:;object-src 'none';script-src 'self';script-src-attr 'none';style-src 'self' https: 'unsafe-inline'
       Referrer-Policy: no-referrer ; X-Content-Type-Options: nosniff ; X-Frame-Options: SAMEORIGIN ; Strict-Transport-Security: max-age=31536000; includeSubDomains
       Preflight OPTIONS /autenticacion/login (Origin: http://localhost:3333) -> 204, Allow-Origin: http://localhost:3333, Allow-Headers: Content-Type,Authorization
       nginx GET / -> Server: nginx
       Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob:; connect-src 'self' http://localhost:4444; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
       X-Content-Type-Options: nosniff ; X-Frame-Options: DENY ; Referrer-Policy: strict-origin-when-cross-origin
       GET /docs/ -> HTTP 200
```
El `index.html` compilado solo tiene `<script type="module" src="/assets/…js">` (ningún script inline), por lo que la CSP `script-src 'self'` no lo bloquea. `'unsafe-inline'` en `style-src` es necesario por los estilos en línea de MUI/Emotion.

### H6 — Límite de intentos de login

**Cambio:** `express-rate-limit` en `POST /autenticacion/login`: máximo **5 intentos fallidos por IP en 15 minutos** (`skipSuccessfulRequests: true`, así los logins correctos no consumen intentos), cabeceras estándar `RateLimit`/`RateLimit-Policy`/`Retry-After` y mensaje JSON.

```
ANTES   12 intentos fallidos: 401 401 401 401 401 401 401 401 401 401 401 401   (sin cabeceras RateLimit)
DESPUÉS 12 intentos fallidos: 401 401 401 401 429 429 429 429 429 429 429 429
        RateLimit-Policy: 5;w=900 ; RateLimit: limit=5, remaining=0, reset=866 ; Retry-After: 866
```
(El primer 401 de la quinta posición no aparece porque en el bloque H1 del mismo script ya hubo 1 intento fallido: 1 + 4 = 5.)

---

## Resultado de `npm audit`

| Proyecto | Antes | Después |
|---|---|---|
| BACKEND (`npm audit --omit=dev`) | **7 vulnerabilidades (1 crítica, 4 altas, 2 moderadas)**: `proxy-addr` (crítica), `body-parser`, `jws`, `path-to-regexp` (altas), `qs`, `morgan` (moderadas), entre otras | **0 vulnerabilidades** |
| FRONTEND (`npm audit`) | 24 (17 altas, 6 moderadas, 1 baja): `axios`, `vite`, `rollup`, `react-router`, `lodash`, `postcss`, … | **Sin cambios (24)** — no corregido, ver abajo |

En el backend se agregaron `bcryptjs@^3`, `helmet@^8`, `express-rate-limit@^7` y se ejecutó `npm audit fix` (sin `--force`, solo actualizaciones compatibles dentro de los rangos semver), que subió `express` a 4.22.3, `multer` a 1.4.5-lts.2, `body-parser` a 1.20.9, `path-to-regexp` a 0.1.13, `qs` a 6.16.2 y `proxy-addr` a 2.0.8.

---

## Archivos modificados

| Archivo | Cambio |
|---|---|
| `CodigoFuenteB/BACKEND/src/config.js` (nuevo) | Lectura centralizada de variables de entorno; `JWT_SECRET` (≥32 caracteres) y `DATABASE_URL` obligatorias, el servidor no arranca si faltan |
| `CodigoFuenteB/BACKEND/src/utils/passwords.js` (nuevo) | `hashPassword`/`verifyPassword` con bcrypt y migración de contraseñas en texto plano al arrancar |
| `CodigoFuenteB/BACKEND/src/middleware/auth.js` (nuevo) | Middleware `requireRole(roles)` (401/403) |
| `CodigoFuenteB/BACKEND/src/app.js` | helmet, CORS restringido a `FRONTEND_URL`, migración de contraseñas antes de `listen` |
| `CodigoFuenteB/BACKEND/src/db.js` | Usa `config.DATABASE_URL`; se quitó la cadena con `alone15` |
| `CodigoFuenteB/BACKEND/src/routes/auth.js` | bcrypt en login/registro, rate limit en login, hash ficticio para tiempo constante, errores genéricos |
| `CodigoFuenteB/BACKEND/src/routes/users.js` | `DELETE` y `POST` solo admin; hash de contraseña en `POST`/`PUT`; auditoría con `usuarioId`; errores genéricos |
| `CodigoFuenteB/BACKEND/src/routes/roles.js` | `POST`/`PUT`/`DELETE` solo admin; auditoría con `usuarioId`; errores genéricos |
| `CodigoFuenteB/BACKEND/src/routes/pacientes.js` | `GET /buscar/rut/:rut` solo médico/admin; errores genéricos |
| `CodigoFuenteB/BACKEND/src/routes/examenes.js`, `documentos.js`, `audit.js` | Secreto desde `config`; errores genéricos |
| `CodigoFuenteB/BACKEND/src/routes/tipo-examen.js` | Errores genéricos |
| `CodigoFuenteB/BACKEND/src/middleware/validate.js` | 500 con `"Error interno"`; detalle solo en consola |
| `CodigoFuenteB/BACKEND/package.json`, `package-lock.json` | Nuevas dependencias + `npm audit fix` |
| `CodigoFuenteB/BACKEND/sql/dump-cuidarteplus.sql` | Contraseñas semilla reemplazadas por su hash bcrypt |
| `CodigoFuenteB/BACKEND/README.md` | Nota sobre bcrypt y variables obligatorias (antes decía "contraseñas en texto plano a propósito") |
| `CodigoFuenteB/BACKEND/.env.example`, `CodigoFuenteB/.env.example` (nuevos) | Plantillas sin valores reales |
| `CodigoFuenteB/BACKEND/uploads/.gitkeep` (nuevo) | El `Dockerfile` hace `COPY uploads/` y la carpeta no estaba versionada |
| `CodigoFuenteB/docker-compose.yml` | `JWT_SECRET` obligatorio (sin valor por defecto) |
| `CodigoFuenteB/README.md` | Eliminado el `JWT_SECRET` publicado; instrucciones para `.env` |
| `CodigoFuenteB/FRONTEND/nginx.conf` | CSP, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `server_tokens off` |
| `CodigoFuenteB/pruebas-seguridad.sh` (nuevo) | Script con las pruebas antes/después |
| `.gitignore`, `.gitattributes` (nuevos) | Excluir `.env`/`node_modules`; forzar LF en `*.sh` (corrige `init-db.sh` en checkouts de Windows) |

---

## Otros problemas encontrados durante las pruebas (no de seguridad)

- **`init-db.sh` no se ejecutaba en Windows:** con `core.autocrlf=true` el script quedaba con CRLF y Postgres fallaba con `/bin/bash^M: bad interpreter`, dejando la BD **sin tablas** (el login respondía 500). En el repositorio el archivo ya está en LF; el CRLF lo agrega git al hacer checkout. Se agregó `.gitattributes` (`*.sh text eol=lf`) para que siempre se extraiga con LF.
- **`docker compose build` fallaba** si no existía `BACKEND/uploads/` (no versionada). Se agregó `.gitkeep`.

## Puntos NO corregidos y por qué

1. **El `JWT_SECRET` antiguo sigue en el historial de git.** Se borró del README, pero el valor `0d1d81…d0e8` está en commits anteriores de `main`. No reescribí el historial (operación destructiva sobre una rama compartida). **Ese secreto debe considerarse comprometido**: cualquier despliegue debe usar uno nuevo (el `.env` local de las pruebas usa uno aleatorio).
2. **Vulnerabilidades del FRONTEND (24 en `npm audit`).** Están fuera de los 6 hallazgos pedidos y su corrección (subir `vite`, `react-router`, `axios`, etc.) puede cambiar el build; además el `FRONTEND/Dockerfile` borra `package-lock.json` y ejecuta `npm install`, así que la imagen no usa versiones fijas. Recomendado como trabajo siguiente.
3. **Lecturas de pacientes/exámenes/documentos no restringidas a solo médico/admin.** Ya exigían autenticación y propiedad del dato (ver H3); se mantuvo el acceso del paciente a sus propios datos porque el frontend depende de él.
4. **Un médico puede cambiar su propio rol a admin** (`PUT /usuarios/:id` con `rol_id`, en `updateUsuarioSistemaMedico`, permite cambiar roles a médico/admin y a cualquier usuario editarse a sí mismo). Encontrado por lectura de código, no estaba en la lista y cambia reglas de negocio; recomendado: solo admin puede cambiar `rol_id`.
5. **Contraseña de Postgres por defecto (`postgres`) y puerto 15442 expuesto al host** en `docker-compose.yml`. Fuera del alcance pedido (la URL de BD sí es obligatoria en el backend). Recomendado: exigir `POSTGRES_PASSWORD` igual que `JWT_SECRET` y no publicar el puerto.
6. **Limitaciones del rate limit:** contador en memoria (se reinicia al reiniciar el backend y no se comparte entre réplicas) y por IP, no por cuenta. Detrás de un proxy habría que configurar `trust proxy`.
7. **Otros detectados por lectura, no corregidos:** `POST /auditoria` permite a cualquier usuario autenticado escribir entradas arbitrarias en la auditoría; `/files/documentos` sirve la carpeta `uploads/documentos` sin autenticación (hoy los documentos se guardan en BD, por lo que la carpeta está vacía); `/docs` y `/openapi.json` son públicos; la política de contraseñas del registro solo exige 6 caracteres; los tokens no se pueden revocar antes de su expiración (2 h).
8. **`GET /examenes` con datos:** el dump no trae exámenes, así que la prueba de filtrado por paciente devolvió 0 filas antes y después; el filtrado se verificó solo por lectura de código.

## Verificación de `admin/admin` tras bcrypt

**Confirmado ejecutándolo**, no supuesto:
- Volumen de BD nuevo (hash del SQL): `POST /autenticacion/login {"nombre_usuario":"admin","password":"admin"}` → **HTTP 200** con token; en BD `admin | $2b$12$Dg6x…`.
- Volumen antiguo con texto plano (migración al arrancar): log `3 contraseña(s) en texto plano migradas a bcrypt` y login `admin/admin` → **HTTP 200**.
- Tras reconstruir el backend con el último cambio: `admin/admin` → **HTTP 200**.

No se probó el frontend en un navegador real (no hubo navegador disponible en la sesión): se verificó por HTTP que el preflight CORS desde `http://localhost:3333` es aceptado, que nginx sirve las cabeceras y que el HTML compilado no tiene scripts inline que la CSP bloquee. Conviene abrir `http://localhost:3333` e iniciar sesión una vez para confirmarlo visualmente.
