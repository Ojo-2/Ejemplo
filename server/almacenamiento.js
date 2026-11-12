// Persistencia del SACG: contrato + implementaciones intercambiables.
//
// CONTRATO (lo que debe cumplir cualquier implementación, p. ej. una BD MySQL o PostgreSQL).
// Está dividido en operaciones pequeñas para que cada consumidor reciba solo las que necesita:
//
//   LECTURA   (almacen.lectura, y también dentro de una transacción)
//     listar(coleccion)                  -> [registro]   en orden de inserción
//     obtener(coleccion, id)             -> registro | null          (inexistente => null)
//     buscar(coleccion, criterio)        -> [registro]   los que cumplen TODOS los campos de `criterio`
//                                                        (igualdad estricta; sin coincidencias => [])
//   ESCRITURA (solo dentro de una transacción)
//     insertar(coleccion, datos)         -> registro con `id` asignado (S-001, M-001, P-001, A-001)
//     actualizar(coleccion, id, cambios) -> registro actualizado; inexistente => lanza ErrorAlmacenamiento('NO_EXISTE')
//   OPERACIÓN ATÓMICA
//     almacen.transaccion(async (tx) => ...)  tx = lectura + escritura. Si la función lanza, no se guarda
//                                             NADA (rollback); si termina, se guarda todo junto (commit).
//                                             Las transacciones se ejecutan una por una.
//
// Reglas comunes a TODAS las implementaciones (así se pueden sustituir sin cambiar a las rutas):
//   - Los registros devueltos son copias: modificarlos no altera lo guardado.
//   - Colección desconocida => ErrorAlmacenamiento('COLECCION_DESCONOCIDA').
//   - `lectura` solo ve datos confirmados (no los de una transacción en curso).
//
// Con una BD real: `insertar` usaría AUTO_INCREMENT/secuencias y `transaccion` sería BEGIN/COMMIT/ROLLBACK.

import fs from 'node:fs';
import path from 'node:path';

export class ErrorAlmacenamiento extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.name = 'ErrorAlmacenamiento';
    this.codigo = codigo;
  }
}

const PREFIJOS = { socios: 'S', membresias: 'M', pagos: 'P', accesos: 'A' };
const COLECCIONES = ['usuarios', 'planes', 'socios', 'pagos', 'membresias', 'accesos'];

const copiar = (v) => structuredClone(v);

function validarEstructura(estado, origen) {
  if (!estado || typeof estado !== 'object') throw new Error(`Datos inválidos: ${origen}`);
  for (const c of COLECCIONES) {
    if (!Array.isArray(estado[c])) throw new Error(`Datos inválidos (${origen}): falta la colección "${c}"`);
  }
  estado.contadores ??= {};
  return estado;
}

function coleccionDe(estado, nombre) {
  if (!COLECCIONES.includes(nombre)) throw new ErrorAlmacenamiento('COLECCION_DESCONOCIDA', `Colección desconocida: ${nombre}`);
  return estado[nombre];
}

/** Operaciones de LECTURA sobre el estado que devuelva `estadoActual()`. */
function crearLectura(estadoActual) {
  return {
    listar: (coleccion) => copiar(coleccionDe(estadoActual(), coleccion)),
    obtener: (coleccion, id) => copiar(coleccionDe(estadoActual(), coleccion).find((r) => r.id === id) ?? null),
    buscar: (coleccion, criterio) =>
      copiar(coleccionDe(estadoActual(), coleccion).filter((r) => Object.entries(criterio).every(([campo, valor]) => r[campo] === valor))),
  };
}

/** Lectura + ESCRITURA sobre el borrador de una transacción. */
function crearTransaccional(borrador) {
  return {
    ...crearLectura(() => borrador),
    insertar(coleccion, datos) {
      const filas = coleccionDe(borrador, coleccion);
      const prefijo = PREFIJOS[coleccion];
      if (!prefijo) throw new ErrorAlmacenamiento('SIN_GENERADOR_DE_ID', `La colección ${coleccion} no admite inserciones.`);
      borrador.contadores[coleccion] = (borrador.contadores[coleccion] ?? 0) + 1;
      const registro = { id: `${prefijo}-${String(borrador.contadores[coleccion]).padStart(3, '0')}`, ...copiar(datos) };
      filas.push(registro);
      return copiar(registro);
    },
    actualizar(coleccion, id, cambios) {
      const filas = coleccionDe(borrador, coleccion);
      const i = filas.findIndex((r) => r.id === id);
      if (i === -1) throw new ErrorAlmacenamiento('NO_EXISTE', `No existe ${coleccion}/${id}`);
      filas[i] = { ...filas[i], ...copiar(cambios), id };
      return copiar(filas[i]);
    },
  };
}

/**
 * Implementación en memoria. Sirve para pruebas y como base de la implementación en archivo.
 * `persistir(estado)` (opcional) se llama en cada commit; si lanza, la transacción falla y no se aplica.
 */
export function crearAlmacenamientoEnMemoria(datosIniciales, { persistir = () => {} } = {}) {
  let estado = validarEstructura(copiar(datosIniciales), 'memoria');
  let cola = Promise.resolve();

  return {
    lectura: crearLectura(() => estado),

    transaccion(fn) {
      const ejecucion = cola.then(async () => {
        const borrador = copiar(estado);
        const resultado = await fn(crearTransaccional(borrador));
        await persistir(borrador);
        estado = borrador;
        return resultado;
      });
      cola = ejecucion.catch(() => {}); // un error no bloquea las siguientes transacciones
      return ejecucion;
    },
  };
}

/**
 * Implementación sobre un archivo JSON (server/data/datos.json).
 * Si `ruta` no existe, se crea copiando `rutaSemilla` (datosDemo.json).
 * Cada commit escribe un archivo temporal y lo renombra, para no dejar el JSON a medias.
 */
export function crearAlmacenamientoArchivo({ ruta, rutaSemilla }) {
  if (!fs.existsSync(ruta)) {
    if (!rutaSemilla || !fs.existsSync(rutaSemilla)) throw new Error(`No existe ${ruta} ni una semilla para crearlo.`);
    fs.mkdirSync(path.dirname(ruta), { recursive: true });
    fs.copyFileSync(rutaSemilla, ruta);
  }
  const datos = JSON.parse(fs.readFileSync(ruta, 'utf8'));

  const persistir = (estado) => {
    const temporal = `${ruta}.tmp`;
    fs.writeFileSync(temporal, JSON.stringify(estado, null, 2));
    fs.renameSync(temporal, ruta);
  };

  return { ...crearAlmacenamientoEnMemoria(datos, { persistir }), ruta };
}
