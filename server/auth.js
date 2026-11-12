// Autenticación y autorización por rol. Solo usa node:crypto (sin dependencias).
//  - Contraseñas: scrypt con sal aleatoria, comparación en tiempo constante.
//  - Sesión: token firmado con HMAC-SHA256 (usuario, rol, expiración), enviado como
//    "Authorization: Bearer <token>". No se guarda en servidor: no hay variables globales mutables.
//  - Permisos: tabla acción -> roles. Cada endpoint declara la acción que exige.
//
// Este módulo no conoce almacenamiento.js: recibe `buscarUsuario(nombre) -> usuario | null`.

import crypto from 'node:crypto';
import { fallo, ok, estadoHttp } from './reglasNegocio.js';

export const ROLES = ['administrador', 'recepcionista'];

// Un rol nuevo se agrega como una columna más: basta incluirlo en las acciones que le correspondan.
// SUPUESTO: los documentos solo definen los dos roles; la matriz exacta está pendiente de confirmar.
export const PERMISOS = {
  'socios:consultar': ['administrador', 'recepcionista'],
  'socios:crear': ['administrador', 'recepcionista'],
  'planes:consultar': ['administrador', 'recepcionista'],
  'pagos:registrar': ['administrador', 'recepcionista'],
  'membresias:activar': ['administrador', 'recepcionista'],
  'membresias:renovar': ['administrador', 'recepcionista'],
  'membresias:consultar': ['administrador', 'recepcionista'],
  'accesos:validar': ['administrador', 'recepcionista'],
  'accesos:bitacora': ['administrador'],
};

const TTL_SEGUNDOS = 8 * 60 * 60;
const base64url = (buf) => Buffer.from(buf).toString('base64url');

// ---------------------------------------------------------------------------
// Contraseñas
// ---------------------------------------------------------------------------

export function hashContrasena(contrasena) {
  const sal = crypto.randomBytes(16);
  const hash = crypto.scryptSync(contrasena, sal, 64);
  return `scrypt$${sal.toString('hex')}$${hash.toString('hex')}`;
}

export function verificarContrasena(contrasena, almacenado) {
  const [esquema, salHex, hashHex] = String(almacenado ?? '').split('$');
  if (esquema !== 'scrypt' || !salHex || !hashHex) return false;
  const esperado = Buffer.from(hashHex, 'hex');
  const calculado = crypto.scryptSync(String(contrasena), Buffer.from(salHex, 'hex'), esperado.length);
  return crypto.timingSafeEqual(esperado, calculado);
}

// Hash de relleno para que "usuario inexistente" tarde lo mismo que "contraseña incorrecta".
const HASH_RELLENO = hashContrasena('relleno-para-igualar-tiempos');

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

export function emitirToken(datos, { secreto, ahoraMs = Date.now(), ttlSegundos = TTL_SEGUNDOS }) {
  const exp = Math.floor(ahoraMs / 1000) + ttlSegundos;
  const cuerpo = base64url(JSON.stringify({ ...datos, exp }));
  const firma = base64url(crypto.createHmac('sha256', secreto).update(cuerpo).digest());
  return { token: `${cuerpo}.${firma}`, exp };
}

/** Datos del token, o null si la firma no coincide, está mal formado o expiró. */
export function verificarToken(token, { secreto, ahoraMs = Date.now() }) {
  if (typeof token !== 'string') return null;
  const [cuerpo, firma, resto] = token.split('.');
  if (!cuerpo || !firma || resto !== undefined) return null;
  const esperada = crypto.createHmac('sha256', secreto).update(cuerpo).digest();
  const recibida = Buffer.from(firma, 'base64url');
  if (recibida.length !== esperada.length || !crypto.timingSafeEqual(recibida, esperada)) return null;
  try {
    const datos = JSON.parse(Buffer.from(cuerpo, 'base64url').toString('utf8'));
    return datos.exp > Math.floor(ahoraMs / 1000) ? datos : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Fábrica: login + middlewares
// ---------------------------------------------------------------------------

export function crearAutenticacion({ buscarUsuario, secreto, ahoraMs = () => Date.now() }) {
  async function login(usuario, contrasena) {
    const detalle = {};
    if (typeof usuario !== 'string' || !usuario.trim()) detalle.usuario = 'El usuario es obligatorio.';
    if (typeof contrasena !== 'string' || !contrasena) detalle.contrasena = 'La contraseña es obligatoria.';
    if (Object.keys(detalle).length > 0) return fallo('DATOS_INVALIDOS', 'Los datos proporcionados no son válidos.', detalle);

    const registro = await buscarUsuario(usuario.trim());
    const valida = verificarContrasena(contrasena, registro?.hash ?? HASH_RELLENO);
    if (!registro || registro.activo === false || !valida) {
      return fallo('CREDENCIALES_INVALIDAS', 'Usuario o contraseña incorrectos.');
    }
    const { token, exp } = emitirToken({ usuario: registro.usuario, rol: registro.rol }, { secreto, ahoraMs: ahoraMs() });
    return ok({
      token,
      expiraEn: new Date(exp * 1000).toISOString(),
      usuario: { usuario: registro.usuario, nombre: registro.nombre, rol: registro.rol },
    });
  }

  const responder = (res, resultado) => res.status(estadoHttp(resultado)).json(resultado);

  /** Exige sesión válida y deja req.sesion = { usuario, rol }. */
  async function requerirSesion(req, res, next) {
    const [esquema, token] = (req.get('authorization') ?? '').split(' ');
    if (esquema !== 'Bearer' || !token) {
      return responder(res, fallo('NO_AUTENTICADO', 'Inicia sesión para usar este recurso.'));
    }
    const datos = verificarToken(token, { secreto, ahoraMs: ahoraMs() });
    // Un usuario desactivado pierde acceso aunque su token no haya expirado.
    const registro = datos ? await buscarUsuario(datos.usuario) : null;
    if (!registro || registro.activo === false) {
      return responder(res, fallo('TOKEN_INVALIDO', 'La sesión no es válida o expiró. Inicia sesión de nuevo.'));
    }
    req.sesion = { usuario: registro.usuario, rol: registro.rol };
    return next();
  }

  /** Middleware completo de un endpoint: sesión válida + rol con permiso para la acción. */
  function requierePermiso(accion) {
    if (!PERMISOS[accion]) throw new Error(`Acción sin definir en PERMISOS: ${accion}`);
    const verificarRol = (req, res, next) => {
      if (!PERMISOS[accion].includes(req.sesion.rol)) {
        return responder(res, fallo('SIN_PERMISO', `El rol "${req.sesion.rol}" no tiene permiso para esta acción (${accion}).`));
      }
      return next();
    };
    return [requerirSesion, verificarRol];
  }

  return { login, requierePermiso };
}
