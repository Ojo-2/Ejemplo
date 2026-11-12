# SACG – Backend (Gym Sports Center)

API REST del **Sistema de Administración y Control de Gimnasio**. Esta fase es **solo backend**: no hay frontend ni carpeta `src/`. El cliente futuro (React + Vite, móvil o escritorio) consumirá esta API sin depender de lógica adicional: **el servidor es la única autoridad de las reglas de negocio**.

- Node.js + Express (JavaScript, ESM). Dependencias de ejecución: **solo `express` y `cors`**. Pruebas con `node:test`.
- Sin base de datos: la persistencia es un archivo JSON creado a partir de `server/data/datosDemo.json`.

> **Aviso importante sobre los datos.** Los documentos del proyecto **no contienen planes, tarifas ni duraciones**. Los planes `mensual` (30 días, $450) y `trimestral` (90 días, $1,200) de los datos de demostración son **SUPUESTOS inventados** para poder probar el flujo, están marcados con `"origen": "SUPUESTO"` y **deben sustituirse por los reales**. Ver [Supuestos](#14-supuestos) y [Pendiente de confirmar](#15-información-pendiente-de-confirmar-con-el-negocio).

---

## 1. Requisitos

- Node.js **20.6 o superior** (probado con Node 24). Comprueba con `node --version`.
- npm (incluido con Node).

## 2. Instalación

```bash
npm install
```

## 3. Ejecución

```bash
npm run server          # http://localhost:3001  (fecha real)
npm run server:demo     # igual, pero con la fecha fija 2026-10-25 y un secreto de demostración
```

`server:demo` lee `.env.demo`: fija el "hoy" del servidor en **2026-10-25** para que los datos de demostración y los ejemplos del documento den siempre el mismo resultado.

En la primera ejecución se crea `server/data/datos.json` copiando `datosDemo.json`. Para volver al estado inicial, detén el servidor y borra `server/data/datos.json`.

Variables de entorno (todas opcionales): `PORT` (3001), `SECRETO_TOKEN` (si falta, se genera uno temporal), `ORIGENES_PERMITIDOS` (CORS; por defecto `http://localhost:5173`), `ARCHIVO_DATOS`, `ZONA_HORARIA` (`America/Mexico_City`), `FECHA_SIMULADA` (`AAAA-MM-DD`).

## 4. Credenciales de demostración

| Usuario | Contraseña | Rol |
|---|---|---|
| `admin` | `Admin#2026` | administrador |
| `recepcion` | `Recep#2026` | recepcionista |

Solo para la demostración. Cámbialas antes de cualquier uso real.

### Datos de demostración (con `server:demo`, hoy = 2026-10-25)

| Socio | Situación | Resultado al validar acceso |
|---|---|---|
| S-001 Ana Torres | trimestral vigente, vence 2026-12-31 | autorizado |
| S-002 Luis Ramírez | mensual vencida el 2026-09-30, con un pago pendiente (P-005) | `MEMBRESIA_VENCIDA` |
| S-003 Carla Méndez | sin pago ni membresía | `SIN_MEMBRESIA` (activar → `PAGO_REQUERIDO`) |
| S-004 Mateo Ruiz | menor con Carta Responsiva, **vence hoy** | autorizado |
| S-005 Pedro Salas | mensual vigente, vence 2026-11-15 | autorizado |
| S-006 Rodrigo Ibarra | **bloqueado** (con membresía vigente) | `SOCIO_BLOQUEADO` |
| S-007 Elena Fuentes | membresía suspendida | `MEMBRESIA_SUSPENDIDA` |
| S-008 Jorge Lara | membresía cancelada | `MEMBRESIA_CANCELADA` |

La bitácora trae 4 accesos (2 autorizados, 2 rechazados).

---

## 5. Arquitectura en capas

```
 Cliente (React, móvil, curl…)
        │  HTTP + JSON
        ▼
┌──────────────────────────────────────────────────────────────┐
│ server/index.js     Express, CORS, errores globales y         │
│                     CONEXIÓN de dependencias (única que elige  │
│                     archivo JSON y reloj real)                 │
├──────────────────────────────────────────────────────────────┤
│ server/routes/*.js  Adaptadores HTTP: leen la petición, llaman │
│                     a las reglas y al almacenamiento, arman la │
│                     respuesta. No calculan vigencias.          │
├────────────────────┬─────────────────────┬───────────────────┤
│ reglasNegocio.js   │ auth.js             │ almacenamiento.js │
│ Reglas PURAS       │ Login, token, roles │ Contrato + JSON   │
│ (sin Express, sin  │ (recibe una función │ (e implementación │
│ disco, sin storage)│ buscarUsuario)      │ en memoria)       │
└────────────────────┴─────────────────────┴───────────────────┘
                                                    │
                                          server/data/datos.json
                                          (semilla: datosDemo.json)
```

Dependencias (flecha = "importa"): `routes → reglasNegocio` · `auth → reglasNegocio` · `index → todo` · `reglasNegocio → nada` · `almacenamiento → nada del proyecto`. Las rutas **no importan** `almacenamiento.js`: lo reciben ya construido desde `index.js`.

```
server/
  index.js
  routes/  socios.js  planes.js  pagos.js  membresias.js  accesos.js  auth.js
  reglasNegocio.js
  almacenamiento.js
  auth.js
  data/    datosDemo.json
  tests/   reglasNegocio.test.js  endpoints.test.js
```

## 6. Endpoints

Todas las respuestas son JSON: `{ "ok": true, "data": … }` o `{ "ok": false, "error": … }`. Salvo el login, se envía `Authorization: Bearer <token>`.

| Método y ruta | Acción | Éxito | Errores posibles |
|---|---|---|---|
| `POST /api/auth/login` | Inicia sesión `{usuario, contrasena}` | 200 | 400, 401 |
| `GET /api/socios?q=` | Lista/busca socios por id, nombre o apellidos | 200 | 401, 403 |
| `POST /api/socios` | Registra un socio | 201 | 400, 401, 403, 409 |
| `GET /api/socios/:id` | Consulta un socio y su membresía | 200 | 401, 403, 404 |
| `GET /api/planes` | Lista los planes persistidos | 200 | 401, 403 |
| `POST /api/pagos` | Registra un pago simulado `{socioId, planId, metodo, monto}` | 201 | 400, 401, 403, 404, 409 |
| `POST /api/membresias/activar` | Activa con un pago `{socioId, pagoId?}` | 201 | 400, 401, 403, 404, 409 |
| `POST /api/membresias/:id/renovar` | Renueva `{planId, pagoId?}` | 200 | 400, 401, 403, 404, 409 |
| `GET /api/membresias/:socioId` | Fechas, vigencia y días restantes | 200 | 401, 403, 404 |
| `POST /api/accesos/validar` | Autoriza o rechaza la entrada `{socioId}` y la registra | 200 | 400, 401, 403 |
| `GET /api/accesos?socioId=&resultado=&desde=&hasta=&limite=` | Bitácora (más reciente primero) | 200 | 400, 401, 403 |

Si no se envía `pagoId`, se usa el **pago confirmado sin aplicar más antiguo** del socio (y del plan indicado, en renovaciones).

## 7. Permisos por rol

| Acción (endpoint) | Administrador | Recepcionista |
|---|:-:|:-:|
| Consultar y registrar socios | ✔ | ✔ |
| Consultar planes | ✔ | ✔ |
| Registrar pagos | ✔ | ✔ |
| Activar, renovar y consultar membresías | ✔ | ✔ |
| Validar accesos | ✔ | ✔ |
| **Consultar la bitácora de accesos** | ✔ | ✘ (403) |

La tabla vive en `PERMISOS` (`server/auth.js`) y cada ruta declara su acción con `auth.requierePermiso('acción')`. **SUPUESTO:** los documentos solo definen los dos roles y que el Administrador supervisa a los empleados; esta matriz está pendiente de confirmar.

---

## 8. Reglas implementadas

**Socios.** Obligatorios: nombre, apellidos, teléfono (10 dígitos), fecha de nacimiento (fecha real `AAAA-MM-DD`, no futura). Correo opcional pero, si viene, con formato válido. Duplicado (409) si coincide el **correo** o la combinación **nombre + apellidos + fecha de nacimiento** (sin distinguir acentos ni mayúsculas). Menores de 18 años requieren `cartaResponsiva: true` para registrarse.

**Pagos.** Métodos: `efectivo`, `tarjeta`, `transferencia`. El **monto es obligatorio y debe ser igual a la tarifa vigente** del plan (409 `MONTO_INCORRECTO`). Un pago **debe pertenecer al socio**, **corresponder al plan**, **coincidir con la tarifa vigente** y **usarse una sola vez** (`PAGO_NO_PERTENECE_AL_SOCIO`, `PAGO_NO_CORRESPONDE_AL_PLAN`, `MONTO_INCORRECTO`, `PAGO_YA_UTILIZADO`). Sin pago disponible: `PAGO_REQUERIDO`.

**Fechas y vencimiento.**
- `vencimiento = inicio + duracionDias` del plan, calculado con fechas de calendario reales (cambio de mes, de año y años bisiestos).
- **El vencimiento es INCLUSIVO**: es el último día con acceso. Una membresía que **vence hoy sigue vigente** y se autoriza; al día siguiente está vencida.
- El inicio también es inclusivo: si `hoy < inicio`, la membresía "todavía no inicia".

**Renovación.**
- *Anticipada* (vigente, incluido "vence hoy"): los días del plan se **suman al vencimiento actual**; el inicio original se conserva (`tipo: ACUMULADA`).
- *Vencida*: el nuevo periodo **empieza hoy** y se cuenta **desde hoy** (`tipo: DESDE_HOY`).
- Se puede **cambiar de plan** al renovar: la duración nueva es la del plan elegido.
- Una membresía **suspendida** o **cancelada** no se renueva (409).

**Acceso.** Se evalúan estas reglas en orden y gana la primera que objeta (`REGLAS_ACCESO`):

| # | Motivo de rechazo | Cuándo |
|---|---|---|
| 1 | `SOCIO_NO_EXISTE` | el id no existe |
| 2 | `SOCIO_BLOQUEADO` | el socio está bloqueado |
| 3 | `CARTA_RESPONSIVA_PENDIENTE` | menor de 18 sin Carta Responsiva |
| 4 | `SIN_MEMBRESIA` | no tiene membresía |
| 5 | `MEMBRESIA_CANCELADA` | estado administrativo cancelada |
| 6 | `MEMBRESIA_SUSPENDIDA` | estado administrativo suspendida |
| 7 | `MEMBRESIA_NO_INICIADA` | `hoy` es anterior al inicio |
| 8 | `MEMBRESIA_VENCIDA` | `hoy` es posterior al vencimiento |

Una entrada rechazada por estas reglas responde **HTTP 200** con `{"autorizado": false, "motivo": "…"}` (la evaluación se hizo bien). **Todo intento queda en la bitácora**, también los rechazados y los de socios inexistentes. Cada registro trae: `id`, `fecha`, `hora`, `socioId`, `resultado` (`AUTORIZADO`/`RECHAZADO`), `motivo`, `membresiaId` (membresía consultada) y `usuario` (quien hizo la operación).

## 9. Ejemplos con curl

En Linux/macOS/Git Bash. En Windows `cmd`, usa `curl.exe` y escapa las comillas dobles (`\"`), o más fácil, abre `peticiones.http` en VS Code con la extensión REST Client.

```bash
# Login (guarda el token)
TOKEN=$(curl -s -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"usuario":"recepcion","contrasena":"Recep#2026"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).data.token')

# Ejemplo 1: acceso autorizado
curl -s -X POST http://localhost:3001/api/accesos/validar -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"socioId":"S-001"}'
# {"ok":true,"data":{"autorizado":true,"venceEl":"2026-12-31"}}

# Ejemplo 2: rechazo por vencimiento (HTTP 200, queda en la bitácora)
curl -s -X POST http://localhost:3001/api/accesos/validar -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"socioId":"S-002"}'
# {"ok":true,"data":{"autorizado":false,"motivo":"MEMBRESIA_VENCIDA"}}

# Ejemplo 3: activar sin pago (HTTP 409)
curl -s -X POST http://localhost:3001/api/membresias/activar -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"socioId":"S-003"}'
# {"ok":false,"error":{"codigo":"PAGO_REQUERIDO","mensaje":"No se puede activar una membresía sin pago."}}

# Ejemplo 4: renovar membresía vencida (empieza hoy: 2026-10-25 → 2026-11-24)
curl -s -X POST http://localhost:3001/api/membresias/M-002/renovar -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"planId":"mensual"}'

# Flujo completo (el socio nuevo recibe el id S-009)
curl -s -X POST http://localhost:3001/api/socios -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"nombre":"Rosa","apellidos":"Vega Luna","telefono":"5511112222","correo":"rosa@example.com","fechaNacimiento":"1995-06-20"}'
curl -s http://localhost:3001/api/planes -H "Authorization: Bearer $TOKEN"
curl -s -X POST http://localhost:3001/api/pagos -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"socioId":"S-009","planId":"mensual","metodo":"efectivo","monto":450}'
curl -s -X POST http://localhost:3001/api/membresias/activar -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"socioId":"S-009"}'
curl -s http://localhost:3001/api/membresias/S-009 -H "Authorization: Bearer $TOKEN"
curl -s -X POST http://localhost:3001/api/accesos/validar -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"socioId":"S-009"}'
# Bitácora: solo administrador (con el token de "recepcion" responde 403)
```

## 10. Formato de errores

```json
{ "ok": false, "error": { "codigo": "CODIGO_ESTABLE", "mensaje": "Descripción comprensible." } }
```

Con errores por campo (400):

```json
{ "ok": false, "error": { "codigo": "DATOS_INVALIDOS", "mensaje": "Los datos del socio no son válidos.",
  "detalle": { "correo": "El correo no tiene un formato válido." } } }
```

| HTTP | Códigos |
|---|---|
| 400 | `DATOS_INVALIDOS`, `JSON_INVALIDO` |
| 401 | `NO_AUTENTICADO`, `TOKEN_INVALIDO`, `CREDENCIALES_INVALIDAS` |
| 403 | `SIN_PERMISO` |
| 404 | `SOCIO_NO_EXISTE`, `PLAN_NO_EXISTE`, `PAGO_NO_EXISTE`, `MEMBRESIA_NO_EXISTE`, `RUTA_NO_ENCONTRADA` |
| 409 | `SOCIO_DUPLICADO`, `PLAN_NO_DISPONIBLE`, `PAGO_REQUERIDO`, `PAGO_NO_PERTENECE_AL_SOCIO`, `PAGO_NO_CORRESPONDE_AL_PLAN`, `PAGO_YA_UTILIZADO`, `MONTO_INCORRECTO`, `MEMBRESIA_EXISTENTE`, `MEMBRESIA_SUSPENDIDA`, `MEMBRESIA_CANCELADA` |
| 413 | `CUERPO_DEMASIADO_GRANDE` |
| 500 | `ERROR_INTERNO` (sin detalles internos) |

## 11. Pruebas

```bash
npm test
```

- `server/tests/reglasNegocio.test.js`: pruebas unitarias de las reglas puras (sin servidor ni disco).
- `server/tests/endpoints.test.js`: pruebas HTTP y del contrato de almacenamiento. Cada prueba inyecta un **almacenamiento temporal** (memoria o carpeta del sistema) y un **reloj controlado**; al final verifican que `datosDemo.json` no cambió.

---

## 12. Aplicación de principios SOLID

| Principio | Módulo | Decisión de diseño | Ejemplo concreto del código | Beneficio para la migración |
|---|---|---|---|---|
| **S** – Responsabilidad única | `index.js`, `routes/*`, `reglasNegocio.js`, `almacenamiento.js`, `auth.js` | Cada archivo hace una sola cosa. Las rutas no calculan fechas ni autorizan: llaman a las reglas. `reglasNegocio.js` no importa nada (sin Express, `req/res` ni `fs`). | `routes/accesos.js` solo valida la solicitud, lee socio y membresía, llama `autorizarAcceso(...)` y guarda el resultado con `construirRegistroAcceso(...)`. | Cambiar de Express a otro framework toca `index.js`/`routes`; cambiar de reglas no toca el HTTP. |
| **O** – Abierto/cerrado | `reglasNegocio.js`, `auth.js`, datos | **Reglas de acceso** como lista ordenada; **roles/permisos** como tabla; **planes y tarifas** solo en los datos. | `REGLAS_ACCESO` es un arreglo de `{motivo, objeta}`: una regla nueva es una entrada nueva (hay una prueba que lo demuestra). `PERMISOS['accesos:bitacora']` lista roles. La prueba "plan nuevo" agrega `semestral` a los datos y funciona sin cambiar código. | Agregar planes, roles o reglas no obliga a reescribir rutas ni reglas existentes. |
| **L** – Sustitución de Liskov | `almacenamiento.js` | Un **contrato documentado** (arriba del archivo) con comportamiento idéntico para registros inexistentes y errores: `obtener` → `null`, `buscar` → `[]`, `actualizar` inexistente → `ErrorAlmacenamiento('NO_EXISTE')`, copias de los registros, rollback si falla. | `endpoints.test.js` corre **la misma batería** sobre `crearAlmacenamientoEnMemoria` y `crearAlmacenamientoArchivo`. El archivo JSON es la memoria más un `persistir()`. | Una clase MySQL/PostgreSQL que pase esa batería sustituye al JSON sin tocar rutas ni reglas. |
| **I** – Segregación de interfaces | `almacenamiento.js`, `routes/planes.js`, `auth.js` | Operaciones pequeñas: `listar`, `obtener`, `buscar` (lectura), `insertar`, `actualizar` (solo dentro de una transacción) y `transaccion`. Cada consumidor recibe solo lo que usa. | `crearRutasPlanes({ lectura, auth })` recibe **solo lectura** (no puede escribir). `crearAutenticacion({ buscarUsuario, … })` recibe **una función**, no el almacén. | Una BD solo debe implementar operaciones simples; los consumidores de solo lectura no dependen de las de escritura. |
| **D** – Inversión de dependencias | `index.js`, `routes/*`, `auth.js` | `crearApp({ almacen, reloj, secreto })` **recibe** sus dependencias; solo el bloque de arranque de `index.js` decide JSON y reloj real. Las rutas no importan `almacenamiento.js`; `reglasNegocio.js` no lo conoce. "Hoy" siempre entra como parámetro. | Pruebas: `crearApp({ almacen: crearAlmacenamientoEnMemoria(DEMO), reloj: relojFalso })`; una prueba inyecta un almacén envuelto que cuenta llamadas y otra mueve el reloj para probar vencimientos. | Para pasar a una BD real solo cambia la línea que construye `almacen` en el arranque. |

**Lo que no se hizo a propósito:** no hay clases/repositorios/servicios vacíos, ni carpetas extra, ni capa de "casos de uso" aparte. Las rutas orquestan (leer → regla → escribir) porque la estructura pedida no incluye otra capa; todas las decisiones están en `reglasNegocio.js`.

---

## 13. Decisiones técnicas

- **Express 5** (los errores de handlers `async` llegan al manejador global) y **ESM**.
- **Token de sesión** firmado con HMAC-SHA256 (`node:crypto`), 8 horas; **contraseñas** con scrypt. Sin almacén de sesiones: el servidor no guarda estado en memoria. Un usuario desactivado pierde acceso aunque su token no haya expirado.
- **Persistencia atómica**: cada transacción trabaja sobre una copia, escribe un archivo temporal y lo renombra; si algo falla no se guarda nada. Las transacciones se serializan.
- **Reloj inyectable** (`{ ahora(), hoy() }`) con zona `America/Mexico_City` y `FECHA_SIMULADA` para demos.
- **CORS cerrado** a `ORIGENES_PERMITIDOS`; cuerpo máximo de 50 KB; cabeceras `nosniff` y `no-store`.
- Ids generados por el almacenamiento: `S-001`, `M-001`, `P-001`, `A-001`.
- Las evaluaciones de acceso devuelven 200; los errores de uso (datos, permisos, recursos) usan 4xx.

## 14. Supuestos

1. **Planes y tarifas de demostración inventados** (mensual 30 días/$450, trimestral 90 días/$1,200), marcados `SUPUESTO`. Moneda: MXN.
2. **Vencimiento inclusivo** y `vencimiento = inicio + duracionDias`. Consecuencia que conviene revisar: un plan de 30 días iniciado el día 1 vence el día 31, es decir, da acceso durante `duracionDias + 1` días de calendario.
3. Duración en **días de calendario**, no en meses.
4. La renovación vencida cuenta desde **hoy**; el documento dice "desde el día del pago" y se asume que el pago se aplica el mismo día.
5. Roles: Administrador y Recepcionista (CRC Usuario). El propietario se trata como Administrador. La matriz de permisos es un supuesto.
6. Campos del socio: nombre, apellidos, teléfono de 10 dígitos, correo opcional, fecha de nacimiento, Carta Responsiva.
7. Estados que los documentos no definen: socio `activo`/`bloqueado`; membresía `activa`/`suspendida`/`cancelada`. Las reglas de acceso los respetan, pero **no hay endpoints para cambiarlos**: solo aparecen en los datos.
8. Pago simulado: se confirma al instante; una membresía por socio; sin prorrateo al cambiar de plan; al renovar con otro plan se aplica la tarifa y duración del plan elegido.
9. Una membresía suspendida o cancelada no se renueva. Un socio bloqueado solo se rechaza en el acceso: registrarle pagos o activarle membresía no se bloquea.
10. Socio inexistente en `validar`: 200 con `SOCIO_NO_EXISTE` y queda en la bitácora.
11. Visitantes y administración de planes (alta/edición) quedan fuera: no están en la lista de endpoints de esta fase.

## 15. Información pendiente de confirmar con el negocio

- Planes, **precios y duraciones reales**, y si la duración es en días o en meses.
- Si el vencimiento es inclusivo y si "30 días" debe dar 30 o 31 días de acceso.
- Desde qué fecha cuenta una renovación vencida (fecha del pago o fecha de aplicación).
- Matriz de permisos exacta (¿puede el recepcionista consultar la bitácora?, ¿quién cambia tarifas?).
- Cómo, cuándo y quién **bloquea** un socio y **suspende o cancela** una membresía; si una membresía cancelada puede renovarse.
- Si un socio bloqueado puede pagar o activar membresía.
- Campos obligatorios definitivos del socio y reglas de duplicados.
- Costo y registro de visitantes.
- Tecnología objetivo: los documentos mencionan Java y MySQL; esta fase usa Node + JSON por indicación del prompt.

## 16. Limitaciones del prototipo

- Archivo JSON: un solo proceso, sin concurrencia entre procesos, sin índices ni paginación (la bitácora usa `limite`).
- Sesiones sin cierre ni revocación del lado del servidor (expiran a las 8 h). Sin límite de intentos de login, HTTPS ni auditoría de cambios.
- Pagos simulados: no hay pasarela, comprobantes, cancelaciones ni reembolsos.
- No hay endpoints para altas/edición de planes, usuarios, bloqueos, suspensiones ni cancelaciones.
- Los datos de demostración son ficticios; las contraseñas de demostración son públicas.

## 17. Puntos que deben migrarse para usar una base de datos real

1. Implementar el contrato de `almacenamiento.js` (`lectura.listar/obtener/buscar`, `transaccion` con `insertar/actualizar`) con el driver elegido y pasarlo a `crearApp` desde el arranque. Debe pasar la misma batería de `endpoints.test.js` ("contrato de almacenamiento").
2. `transaccion` → `BEGIN/COMMIT/ROLLBACK`; `NO_EXISTE` cuando un `UPDATE` no afecte filas; ids con secuencias o `AUTO_INCREMENT` (hoy `S-001`… los asigna el almacenamiento).
3. Tablas: `usuarios`, `planes`, `socios`, `pagos`, `membresias` (+ `historial`), `accesos`. Restricciones: correo único, un solo uso de cada pago, una membresía por socio.
4. `buscar(coleccion, criterio)` equivale a `WHERE campo = valor`; conviene indexar `socioId` y `usuario`.
5. Mover la búsqueda de socios y el filtrado de la bitácora a consultas con filtros y paginación en la base de datos (hoy se filtra en memoria en `reglasNegocio.js`).
6. Reemplazar `datosDemo.json` por un script de siembra y guardar `SECRETO_TOKEN` y credenciales fuera del repositorio.

---

## 18. Matriz de trazabilidad

Las pruebas se citan por archivo: **U** = `reglasNegocio.test.js`, **E** = `endpoints.test.js` (entre cursivas, parte del nombre de la prueba).

| Regla (documento / prompt) | Módulo que la implementa | Endpoint | Prueba que la verifica |
|---|---|---|---|
| Validar datos del socio: obligatorios, formatos, correo, teléfono, fecha de nacimiento | `reglasNegocio.validarSocio` | `POST /api/socios` | U: *datos obligatorios*, *formatos inválidos*; E: *400: datos inválidos con detalle por campo* |
| Rechazar socios duplicados | `validarSocio` | `POST /api/socios` | U: *socio duplicado*; E: *409: rechaza duplicados* |
| Menores de 18 requieren Carta Responsiva (documentos) | `validarSocio`, `REGLAS_ACCESO` | `POST /api/socios`, `POST /api/accesos/validar` | U: *menor de 18 sin Carta Responsiva*; E: *un menor sin Carta Responsiva no se registra* |
| Registrar pago simulado con tarifa vigente | `validarPago` | `POST /api/pagos` | U: *validarPago: monto igual a la tarifa vigente*; E: *pago correcto*, *409: rechaza monto incorrecto* |
| El pago pertenece al socio / corresponde al plan / se usa una vez / coincide con la tarifa | `verificarPagoAplicable` | `POST /api/membresias/activar`, `…/renovar` | U: *pago de otro socio*, *pago ya utilizado*, *monto incorrecto*, *pago de otro plan*; E: *409: pago de otro socio, pago ya utilizado…* |
| Activar membresía solo después de un pago válido | `activarMembresia` | `POST /api/membresias/activar` | U: *activación sin pago*, *activación con pago válido*; E: *409 PAGO_REQUERIDO (ejemplo 3)* |
| Calcular inicio y vencimiento según la duración del plan | `calcularVencimiento`, `activarMembresia` | `POST /api/membresias/activar` | U: *cambio de mes*, *cambio de año*, *año bisiesto*; E: *recorrido de punta a punta* |
| Vencimiento inclusivo: "vence hoy" sigue vigente | `vigenciaMembresia` | `POST /api/accesos/validar` | U: *membresía que vence hoy*; E: *el reloj inyectado decide el "hoy"* |
| Renovación anticipada (suma al vencimiento actual) | `renovarMembresia` | `POST /api/membresias/:id/renovar` | U: *renovación anticipada*, *renovar el mismo día del vencimiento*; E: *recorrido de punta a punta* |
| Renovación de membresía vencida (desde hoy; ejemplo 4) | `renovarMembresia` | `POST /api/membresias/:id/renovar` | U: *renovación vencida*; E: *renovación de membresía vencida (ejemplo 4)* |
| Cambio de plan al renovar | `renovarMembresia` | `POST /api/membresias/:id/renovar` | U: *cambio de plan*; E: *cambio de plan al renovar* |
| No renovar membresías suspendidas o canceladas (supuesto) | `renovarMembresia` | `POST /api/membresias/:id/renovar` | U: *no se renuevan membresías suspendidas ni canceladas*; E: *409: renovar sin pago, con pago de otro plan…* |
| Consultar fechas y estado de la membresía | `vistaMembresia`, `vigenciaMembresia` | `GET /api/membresias/:socioId` | E: *recorrido de punta a punta*, *404: socio, membresía…* |
| Membresía que todavía no inicia | `REGLAS_ACCESO` (`MEMBRESIA_NO_INICIADA`) | `POST /api/accesos/validar` | U: *membresía que todavía no inicia*; E: *el reloj inyectado decide el "hoy"* |
| Socio inexistente / bloqueado | `REGLAS_ACCESO` | `POST /api/accesos/validar` | U: *socio inexistente*, *socio bloqueado*; E: *cada motivo de los datos de demostración* |
| Membresía vencida / suspendida / cancelada / sin membresía | `REGLAS_ACCESO` | `POST /api/accesos/validar` | U: *membresía suspendida*, *cancelada*, *sin membresía*, *el día siguiente al vencimiento*; E: *ejemplo 2*, *cada motivo…* |
| Rechazo con motivo explícito y HTTP 200 | `autorizarAcceso` | `POST /api/accesos/validar` | E: *ejemplo 1*, *ejemplo 2* |
| Registrar todos los intentos (autorizados y rechazados) con id, fecha/hora, socio, resultado, motivo, membresía y usuario | `construirRegistroAcceso` | `POST /api/accesos/validar`, `GET /api/accesos` | U: *construirRegistroAcceso*; E: *todo intento se registra…*, *ejemplo 2 … queda en la bitácora* |
| Consultar la bitácora con filtros | `validarFiltrosBitacora`, `filtrarBitacora` | `GET /api/accesos` | U: *filtros de bitácora*; E: *la bitácora se puede filtrar…* |
| Inicio de sesión y token | `auth.crearAutenticacion` | `POST /api/auth/login` | E: *inicio de sesión* (correcto, incorrecto, 400) |
| Permisos por rol en cada endpoint | `auth.PERMISOS`, `requierePermiso` | todos | E: *permisos por rol* (los 10 endpoints × 2 roles + anónimo), *403*, *401* |
| Formato uniforme de errores y códigos HTTP | `fallo`, `estadoHttp`, manejador global de `index.js` | todos | U: *resultado uniforme*; E: *códigos HTTP y formato uniforme de errores* (400, 401, 403, 404, 500) |
| Planes, precios y duraciones salen de los datos | `almacenamiento` + `datosDemo.json` | `GET /api/planes`, `POST /api/pagos` | E: *los planes salen de los datos persistidos*, *un cambio de tarifa… se aplica de inmediato* |
| Persistencia sustituible (contrato) y atómica | `almacenamiento.js` | todos | E: *contrato de almacenamiento* (memoria y archivo JSON), *la API acepta cualquier objeto que cumpla el contrato* |
| Las reglas viven en el servidor y no dependen de Express ni del disco | `reglasNegocio.js` (sin imports) | todos | verificable con `grep "^import" server/reglasNegocio.js` (sin resultados) |
