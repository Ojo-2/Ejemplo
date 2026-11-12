// Pruebas de comportamiento HTTP y del contrato de almacenamiento.
// Cada prueba usa una COPIA de datosDemo.json en memoria (o en una carpeta temporal) y un reloj controlado:
// los datos originales nunca se modifican.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, afterEach, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { crearAlmacenamientoArchivo, crearAlmacenamientoEnMemoria, ErrorAlmacenamiento } from '../almacenamiento.js';
import { emitirToken, PERMISOS } from '../auth.js';
import { crearApp } from '../index.js';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const RUTA_DEMO = path.join(DIR, '..', 'data', 'datosDemo.json');
const DEMO = JSON.parse(fs.readFileSync(RUTA_DEMO, 'utf8'));
const HASH_DEMO_ORIGINAL = crypto.createHash('sha256').update(fs.readFileSync(RUTA_DEMO)).digest('hex');
const SECRETO = 'secreto-de-pruebas';

const servidores = [];
const carpetas = [];
afterEach(() => {
  while (servidores.length) servidores.pop().close();
});
after(() => {
  for (const c of carpetas) fs.rmSync(c, { recursive: true, force: true });
  // Garantía de las pruebas: los datos de demostración originales quedaron intactos.
  const hash = crypto.createHash('sha256').update(fs.readFileSync(RUTA_DEMO)).digest('hex');
  assert.equal(hash, HASH_DEMO_ORIGINAL);
});

/** Reloj controlado: `r.fecha = '2026-11-01'` mueve el "hoy" del servidor. */
function crearRelojFalso(fecha = '2026-10-25', hora = '09:00:00') {
  const r = { fecha, hora, ahora: () => ({ fecha: r.fecha, hora: r.hora }), hoy: () => r.fecha };
  return r;
}

/** Arranca la API con almacenamiento y reloj inyectados, en un puerto libre. */
async function iniciar({ almacen = crearAlmacenamientoEnMemoria(DEMO), reloj = crearRelojFalso(), ahoraMs } = {}) {
  const app = crearApp({ almacen, reloj, secreto: SECRETO, origenesPermitidos: ['http://localhost:5173'], ahoraMs });
  const servidor = await new Promise((resolver) => {
    const s = app.listen(0, '127.0.0.1', () => resolver(s));
  });
  servidores.push(servidor);
  const base = `http://127.0.0.1:${servidor.address().port}`;

  async function llamar(metodo, ruta, { token, cuerpo, crudo } = {}) {
    const res = await fetch(base + ruta, {
      method: metodo,
      headers: { ...(cuerpo !== undefined || crudo !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: crudo ?? (cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined),
    });
    return { estado: res.status, cuerpo: await res.json(), cabeceras: res.headers };
  }
  const login = async (usuario, contrasena) => (await llamar('POST', '/api/auth/login', { cuerpo: { usuario, contrasena } })).cuerpo.data?.token;
  const recepcion = await login('recepcion', 'Recep#2026');
  const admin = await login('admin', 'Admin#2026');
  return { almacen, reloj, llamar, recepcion, admin, base };
}

const socioNuevo = { nombre: 'Rosa', apellidos: 'Vega Luna', telefono: '5511112222', correo: 'rosa.vega@example.com', fechaNacimiento: '1995-06-20' };
const esperarError = (r, estado, codigo) => {
  assert.equal(r.estado, estado, JSON.stringify(r.cuerpo));
  assert.equal(r.cuerpo.ok, false);
  assert.equal(r.cuerpo.error.codigo, codigo);
  assert.equal(typeof r.cuerpo.error.mensaje, 'string');
};

// ---------------------------------------------------------------------------
describe('inicio de sesión', () => {
  test('correcto: devuelve token, rol y expiración', async () => {
    const { llamar } = await iniciar();
    const r = await llamar('POST', '/api/auth/login', { cuerpo: { usuario: 'admin', contrasena: 'Admin#2026' } });
    assert.equal(r.estado, 200);
    assert.equal(r.cuerpo.ok, true);
    assert.equal(r.cuerpo.data.usuario.rol, 'administrador');
    assert.ok(r.cuerpo.data.token.includes('.'));
    assert.equal(r.cuerpo.data.hash, undefined);
  });

  test('incorrecto: contraseña errónea y usuario inexistente dan el mismo 401', async () => {
    const { llamar } = await iniciar();
    const a = await llamar('POST', '/api/auth/login', { cuerpo: { usuario: 'admin', contrasena: 'mala' } });
    const b = await llamar('POST', '/api/auth/login', { cuerpo: { usuario: 'nadie', contrasena: 'mala' } });
    esperarError(a, 401, 'CREDENCIALES_INVALIDAS');
    assert.deepEqual(a.cuerpo, b.cuerpo);
  });

  test('400: faltan usuario y contraseña => DATOS_INVALIDOS con detalle por campo', async () => {
    const { llamar } = await iniciar();
    const r = await llamar('POST', '/api/auth/login', { cuerpo: {} });
    esperarError(r, 400, 'DATOS_INVALIDOS');
    assert.deepEqual(Object.keys(r.cuerpo.error.detalle).sort(), ['contrasena', 'usuario']);
  });
});

// ---------------------------------------------------------------------------
describe('códigos HTTP y formato uniforme de errores', () => {
  test('401: sin token, token alterado y token expirado', async () => {
    const ahora = Date.now();
    const { llamar, recepcion } = await iniciar({ ahoraMs: () => ahora });
    esperarError(await llamar('GET', '/api/planes'), 401, 'NO_AUTENTICADO');
    esperarError(await llamar('GET', '/api/planes', { token: `${recepcion}x` }), 401, 'TOKEN_INVALIDO');
    esperarError(await llamar('GET', '/api/planes', { token: 'basura' }), 401, 'TOKEN_INVALIDO');
    const caducado = emitirToken({ usuario: 'admin', rol: 'administrador' }, { secreto: SECRETO, ahoraMs: ahora - 9 * 3600 * 1000 }).token;
    esperarError(await llamar('GET', '/api/planes', { token: caducado }), 401, 'TOKEN_INVALIDO');
  });

  test('401: un token de rol falsificado no sirve (la firma lo protege)', async () => {
    const { llamar } = await iniciar();
    const falso = emitirToken({ usuario: 'recepcion', rol: 'administrador' }, { secreto: 'otro-secreto' }).token;
    esperarError(await llamar('GET', '/api/accesos', { token: falso }), 401, 'TOKEN_INVALIDO');
  });

  test('403: el recepcionista no puede consultar la bitácora', async () => {
    const { llamar, recepcion } = await iniciar();
    esperarError(await llamar('GET', '/api/accesos', { token: recepcion }), 403, 'SIN_PERMISO');
  });

  test('404: socio, membresía, pago y ruta inexistentes', async () => {
    const { llamar, recepcion } = await iniciar();
    esperarError(await llamar('GET', '/api/socios/S-999', { token: recepcion }), 404, 'SOCIO_NO_EXISTE');
    esperarError(await llamar('GET', '/api/membresias/S-999', { token: recepcion }), 404, 'SOCIO_NO_EXISTE');
    esperarError(await llamar('GET', '/api/membresias/S-003', { token: recepcion }), 404, 'MEMBRESIA_NO_EXISTE');
    esperarError(await llamar('POST', '/api/membresias/M-999/renovar', { token: recepcion, cuerpo: { planId: 'mensual' } }), 404, 'MEMBRESIA_NO_EXISTE');
    esperarError(await llamar('POST', '/api/membresias/activar', { token: recepcion, cuerpo: { socioId: 'S-999' } }), 404, 'SOCIO_NO_EXISTE');
    esperarError(await llamar('POST', '/api/membresias/activar', { token: recepcion, cuerpo: { socioId: 'S-003', pagoId: 'P-999' } }), 404, 'PAGO_NO_EXISTE');
    esperarError(await llamar('POST', '/api/pagos', { token: recepcion, cuerpo: { socioId: 'S-003', planId: 'no-existe', metodo: 'efectivo', monto: 1 } }), 404, 'PLAN_NO_EXISTE');
    esperarError(await llamar('GET', '/api/no-existe', { token: recepcion }), 404, 'RUTA_NO_ENCONTRADA');
  });

  test('400: datos inválidos con detalle por campo, en cada endpoint que recibe cuerpo', async () => {
    const { llamar, recepcion } = await iniciar();
    const r = await llamar('POST', '/api/socios', { token: recepcion, cuerpo: { nombre: '', correo: 'x', telefono: '1' } });
    esperarError(r, 400, 'DATOS_INVALIDOS');
    assert.equal(r.cuerpo.error.mensaje, 'Los datos del socio no son válidos.');
    assert.equal(r.cuerpo.error.detalle.correo, 'El correo no tiene un formato válido.');
    esperarError(await llamar('POST', '/api/pagos', { token: recepcion, cuerpo: {} }), 400, 'DATOS_INVALIDOS');
    esperarError(await llamar('POST', '/api/membresias/activar', { token: recepcion, cuerpo: {} }), 400, 'DATOS_INVALIDOS');
    esperarError(await llamar('POST', '/api/membresias/M-001/renovar', { token: recepcion, cuerpo: {} }), 400, 'DATOS_INVALIDOS');
    esperarError(await llamar('POST', '/api/accesos/validar', { token: recepcion, cuerpo: {} }), 400, 'DATOS_INVALIDOS');
  });

  test('400: JSON mal formado y filtros inválidos de la bitácora', async () => {
    const { llamar, recepcion, admin } = await iniciar();
    esperarError(await llamar('POST', '/api/socios', { token: recepcion, crudo: '{no es json' }), 400, 'JSON_INVALIDO');
    esperarError(await llamar('GET', '/api/accesos?resultado=TAL', { token: admin }), 400, 'DATOS_INVALIDOS');
  });

  test('500: un fallo inesperado del almacenamiento devuelve el formato uniforme sin filtrar detalles', async (t) => {
    t.mock.method(console, 'error', () => {});
    const roto = { lectura: { ...crearAlmacenamientoEnMemoria(DEMO).lectura }, transaccion: async () => { throw new Error('DISCO LLENO /secreto/ruta'); } };
    const { llamar, recepcion } = await iniciar({ almacen: roto });
    const r = await llamar('POST', '/api/socios', { token: recepcion, cuerpo: socioNuevo });
    esperarError(r, 500, 'ERROR_INTERNO');
    assert.ok(!JSON.stringify(r.cuerpo).includes('DISCO LLENO'));
  });

  test('cabeceras de seguridad y CORS cerrado a los orígenes permitidos', async () => {
    const { base } = await iniciar();
    const permitido = await fetch(`${base}/api/planes`, { headers: { origin: 'http://localhost:5173' } });
    assert.equal(permitido.headers.get('access-control-allow-origin'), 'http://localhost:5173');
    const ajeno = await fetch(`${base}/api/planes`, { headers: { origin: 'http://malo.example' } });
    assert.equal(ajeno.headers.get('access-control-allow-origin'), null);
    assert.equal(ajeno.headers.get('x-powered-by'), null);
    assert.equal(ajeno.headers.get('x-content-type-options'), 'nosniff');
  });
});

// ---------------------------------------------------------------------------
describe('flujo completo: registro -> plan -> pago -> activación -> fechas -> acceso -> bitácora -> renovación', () => {
  test('recorrido de punta a punta', async () => {
    const { llamar, recepcion, admin, reloj } = await iniciar();

    const planes = await llamar('GET', '/api/planes', { token: recepcion });
    assert.equal(planes.estado, 200);
    assert.deepEqual(planes.cuerpo.data.map((p) => p.id), ['mensual', 'trimestral']);

    const alta = await llamar('POST', '/api/socios', { token: recepcion, cuerpo: socioNuevo });
    assert.equal(alta.estado, 201);
    const socioId = alta.cuerpo.data.id;
    assert.equal(socioId, 'S-009');
    assert.equal(alta.cuerpo.data.estado, 'activo');
    assert.equal(alta.cuerpo.data.membresia, null);

    // Todavía sin membresía y sin pago.
    assert.deepEqual((await llamar('POST', '/api/accesos/validar', { token: recepcion, cuerpo: { socioId } })).cuerpo.data, { autorizado: false, motivo: 'SIN_MEMBRESIA' });
    esperarError(await llamar('POST', '/api/membresias/activar', { token: recepcion, cuerpo: { socioId } }), 409, 'PAGO_REQUERIDO');

    const pago = await llamar('POST', '/api/pagos', { token: recepcion, cuerpo: { socioId, planId: 'mensual', metodo: 'efectivo', monto: 450 } });
    assert.equal(pago.estado, 201);
    assert.equal(pago.cuerpo.data.monto, 450);
    assert.equal(pago.cuerpo.data.aplicado, false);
    assert.equal(pago.cuerpo.data.registradoPor, 'recepcion');

    const activada = await llamar('POST', '/api/membresias/activar', { token: recepcion, cuerpo: { socioId } });
    assert.equal(activada.estado, 201);
    assert.equal(activada.cuerpo.data.inicio, '2026-10-25');
    assert.equal(activada.cuerpo.data.vencimiento, '2026-11-24');
    assert.equal(activada.cuerpo.data.vigencia, 'vigente');
    const membresiaId = activada.cuerpo.data.id;

    const consulta = await llamar('GET', `/api/membresias/${socioId}`, { token: recepcion });
    assert.equal(consulta.estado, 200);
    assert.equal(consulta.cuerpo.data.diasRestantes, 30);
    assert.equal(consulta.cuerpo.data.plan.id, 'mensual');

    const entra = await llamar('POST', '/api/accesos/validar', { token: recepcion, cuerpo: { socioId } });
    assert.deepEqual(entra.cuerpo, { ok: true, data: { autorizado: true, venceEl: '2026-11-24' } });

    // Renovación anticipada: se suma al vencimiento actual.
    await llamar('POST', '/api/pagos', { token: recepcion, cuerpo: { socioId, planId: 'mensual', metodo: 'tarjeta', monto: 450 } });
    const renovada = await llamar('POST', `/api/membresias/${membresiaId}/renovar`, { token: recepcion, cuerpo: { planId: 'mensual' } });
    assert.equal(renovada.estado, 200);
    assert.equal(renovada.cuerpo.data.renovacion.tipo, 'ACUMULADA');
    assert.equal(renovada.cuerpo.data.inicio, '2026-10-25');
    assert.equal(renovada.cuerpo.data.vencimiento, '2026-12-24');

    // Pasa el tiempo: el último día aún entra; al día siguiente se rechaza.
    reloj.fecha = '2026-12-24';
    assert.equal((await llamar('POST', '/api/accesos/validar', { token: recepcion, cuerpo: { socioId } })).cuerpo.data.autorizado, true);
    reloj.fecha = '2026-12-25';
    assert.deepEqual((await llamar('POST', '/api/accesos/validar', { token: recepcion, cuerpo: { socioId } })).cuerpo.data, { autorizado: false, motivo: 'MEMBRESIA_VENCIDA' });

    // Bitácora: los 4 intentos del socio, autorizados y rechazados.
    const bitacora = await llamar('GET', `/api/accesos?socioId=${socioId}`, { token: admin });
    assert.equal(bitacora.estado, 200);
    assert.deepEqual(bitacora.cuerpo.data.map((a) => [a.resultado, a.motivo]), [
      ['RECHAZADO', 'MEMBRESIA_VENCIDA'],
      ['AUTORIZADO', null],
      ['AUTORIZADO', null],
      ['RECHAZADO', 'SIN_MEMBRESIA'],
    ]);
  });

  test('renovación de membresía vencida (ejemplo 4): empieza hoy y consume el pago pendiente', async () => {
    const { llamar, recepcion } = await iniciar();
    const r = await llamar('POST', '/api/membresias/M-002/renovar', { token: recepcion, cuerpo: { planId: 'mensual' } });
    assert.equal(r.estado, 200);
    assert.equal(r.cuerpo.data.renovacion.tipo, 'DESDE_HOY');
    assert.equal(r.cuerpo.data.renovacion.vencimientoAnterior, '2026-09-30');
    assert.equal(r.cuerpo.data.inicio, '2026-10-25');
    assert.equal(r.cuerpo.data.vencimiento, '2026-11-24');
    assert.equal(r.cuerpo.data.pagoId, 'P-005');
    // El pago ya no se puede reutilizar.
    esperarError(await llamar('POST', '/api/membresias/M-002/renovar', { token: recepcion, cuerpo: { planId: 'mensual', pagoId: 'P-005' } }), 409, 'PAGO_YA_UTILIZADO');
  });
});

// ---------------------------------------------------------------------------
describe('socios', () => {
  test('registro correcto, consulta por id y búsqueda por nombre', async () => {
    const { llamar, recepcion } = await iniciar();
    const alta = await llamar('POST', '/api/socios', { token: recepcion, cuerpo: socioNuevo });
    assert.equal(alta.estado, 201);
    assert.equal(alta.cuerpo.data.registradoPor, 'recepcion');
    assert.equal(alta.cuerpo.data.fechaRegistro, '2026-10-25');
    const uno = await llamar('GET', `/api/socios/${alta.cuerpo.data.id}`, { token: recepcion });
    assert.equal(uno.cuerpo.data.nombre, 'Rosa');
    const busqueda = await llamar('GET', '/api/socios?q=ramirez', { token: recepcion });
    assert.deepEqual(busqueda.cuerpo.data.map((s) => s.id), ['S-002']);
    assert.equal(busqueda.cuerpo.data[0].membresia.vigencia, 'vencida');
  });

  test('409: rechaza duplicados por correo y por nombre + apellidos + fecha de nacimiento', async () => {
    const { llamar, recepcion } = await iniciar();
    await llamar('POST', '/api/socios', { token: recepcion, cuerpo: socioNuevo });
    esperarError(await llamar('POST', '/api/socios', { token: recepcion, cuerpo: { ...socioNuevo, nombre: 'Otra', apellidos: 'Persona', fechaNacimiento: '1980-01-01' } }), 409, 'SOCIO_DUPLICADO');
    const porIdentidad = await llamar('POST', '/api/socios', { token: recepcion, cuerpo: { ...socioNuevo, correo: 'otro@example.com', nombre: 'ROSA' } });
    esperarError(porIdentidad, 409, 'SOCIO_DUPLICADO');
    assert.equal((await llamar('GET', '/api/socios', { token: recepcion })).cuerpo.data.length, DEMO.socios.length + 1);
  });

  test('un menor sin Carta Responsiva no se registra; con carta, sí', async () => {
    const { llamar, recepcion } = await iniciar();
    const menor = { ...socioNuevo, fechaNacimiento: '2012-03-01' };
    esperarError(await llamar('POST', '/api/socios', { token: recepcion, cuerpo: menor }), 400, 'DATOS_INVALIDOS');
    assert.equal((await llamar('POST', '/api/socios', { token: recepcion, cuerpo: { ...menor, cartaResponsiva: true } })).estado, 201);
  });
});

// ---------------------------------------------------------------------------
describe('pagos', () => {
  test('pago correcto: el servidor confirma el pago con el precio del plan', async () => {
    const { llamar, recepcion } = await iniciar();
    const r = await llamar('POST', '/api/pagos', { token: recepcion, cuerpo: { socioId: 'S-003', planId: 'trimestral', metodo: 'transferencia', monto: 1200 } });
    assert.equal(r.estado, 201);
    assert.deepEqual([r.cuerpo.data.estado, r.cuerpo.data.concepto, r.cuerpo.data.id], ['confirmado', 'ALTA', 'P-009']);
  });

  test('409: rechaza monto incorrecto y no guarda el pago', async () => {
    const { llamar, recepcion, almacen } = await iniciar();
    const r = await llamar('POST', '/api/pagos', { token: recepcion, cuerpo: { socioId: 'S-003', planId: 'mensual', metodo: 'efectivo', monto: 100 } });
    esperarError(r, 409, 'MONTO_INCORRECTO');
    assert.ok(r.cuerpo.error.detalle.monto.includes('450'));
    assert.equal((await almacen.lectura.listar('pagos')).length, DEMO.pagos.length);
  });
});

// ---------------------------------------------------------------------------
describe('activación y renovación: reglas de pago por HTTP', () => {
  test('409 PAGO_REQUERIDO (ejemplo 3): S-003 no tiene pago registrado', async () => {
    const { llamar, recepcion } = await iniciar();
    const r = await llamar('POST', '/api/membresias/activar', { token: recepcion, cuerpo: { socioId: 'S-003' } });
    esperarError(r, 409, 'PAGO_REQUERIDO');
    assert.equal(r.cuerpo.error.mensaje, 'No se puede activar una membresía sin pago.');
    assert.deepEqual(Object.keys(r.cuerpo.error), ['codigo', 'mensaje']);
  });

  test('409: pago de otro socio, pago ya utilizado y pago de otro plan', async () => {
    const { llamar, recepcion, almacen } = await iniciar();
    esperarError(await llamar('POST', '/api/membresias/activar', { token: recepcion, cuerpo: { socioId: 'S-003', pagoId: 'P-005' } }), 409, 'PAGO_NO_PERTENECE_AL_SOCIO');
    esperarError(await llamar('POST', '/api/membresias/activar', { token: recepcion, cuerpo: { socioId: 'S-003', pagoId: 'P-001' } }), 409, 'PAGO_NO_PERTENECE_AL_SOCIO');
    // Pago ya usado del propio socio: S-003 paga, activa, e intenta reutilizar el mismo pago.
    const p = await llamar('POST', '/api/pagos', { token: recepcion, cuerpo: { socioId: 'S-003', planId: 'mensual', metodo: 'efectivo', monto: 450 } });
    assert.equal((await llamar('POST', '/api/membresias/activar', { token: recepcion, cuerpo: { socioId: 'S-003', pagoId: p.cuerpo.data.id } })).estado, 201);
    esperarError(await llamar('POST', '/api/membresias/activar', { token: recepcion, cuerpo: { socioId: 'S-003', pagoId: p.cuerpo.data.id } }), 409, 'MEMBRESIA_EXISTENTE');
    esperarError(await llamar('POST', '/api/membresias/M-001/renovar', { token: recepcion, cuerpo: { planId: 'mensual', pagoId: p.cuerpo.data.id } }), 409, 'PAGO_NO_PERTENECE_AL_SOCIO');
    esperarError(await llamar('POST', '/api/membresias/M-003/renovar', { token: recepcion, cuerpo: { planId: 'mensual' } }), 404, 'MEMBRESIA_NO_EXISTE');
    const m = await almacen.lectura.obtener('pagos', p.cuerpo.data.id);
    assert.equal(m.aplicado, true);
  });

  test('409: renovar sin pago, con pago de otro plan, y membresías suspendidas o canceladas', async () => {
    const { llamar, recepcion } = await iniciar();
    esperarError(await llamar('POST', '/api/membresias/M-001/renovar', { token: recepcion, cuerpo: { planId: 'mensual' } }), 409, 'PAGO_REQUERIDO');
    esperarError(await llamar('POST', '/api/membresias/M-002/renovar', { token: recepcion, cuerpo: { planId: 'trimestral', pagoId: 'P-005' } }), 409, 'PAGO_NO_CORRESPONDE_AL_PLAN');
    esperarError(await llamar('POST', '/api/membresias/M-007/renovar', { token: recepcion, cuerpo: { planId: 'mensual' } }), 409, 'MEMBRESIA_SUSPENDIDA');
    esperarError(await llamar('POST', '/api/membresias/M-008/renovar', { token: recepcion, cuerpo: { planId: 'mensual' } }), 409, 'MEMBRESIA_CANCELADA');
  });

  test('409 MONTO_INCORRECTO al activar: la tarifa cambió después de registrar el pago', async () => {
    const datos = structuredClone(DEMO);
    datos.pagos.push({ id: 'P-009', socioId: 'S-003', planId: 'mensual', monto: 400, estado: 'confirmado', fecha: '2026-10-20', hora: '10:00:00', aplicado: false, membresiaId: null });
    datos.contadores.pagos = 9;
    const { llamar, recepcion } = await iniciar({ almacen: crearAlmacenamientoEnMemoria(datos) });
    esperarError(await llamar('POST', '/api/membresias/activar', { token: recepcion, cuerpo: { socioId: 'S-003' } }), 409, 'MONTO_INCORRECTO');
  });

  test('cambio de plan al renovar: la nueva duración sale del plan elegido', async () => {
    const { llamar, recepcion } = await iniciar();
    await llamar('POST', '/api/pagos', { token: recepcion, cuerpo: { socioId: 'S-005', planId: 'trimestral', metodo: 'tarjeta', monto: 1200 } });
    const r = await llamar('POST', '/api/membresias/M-005/renovar', { token: recepcion, cuerpo: { planId: 'trimestral' } });
    assert.equal(r.estado, 200);
    assert.equal(r.cuerpo.data.planId, 'trimestral');
    assert.equal(r.cuerpo.data.vencimiento, '2027-02-13'); // 2026-11-15 + 90 días
  });
});

// ---------------------------------------------------------------------------
describe('control de acceso y bitácora', () => {
  test('ejemplo 1: acceso autorizado, 200, con la fecha de vencimiento', async () => {
    const { llamar, recepcion } = await iniciar();
    const r = await llamar('POST', '/api/accesos/validar', { token: recepcion, cuerpo: { socioId: 'S-001' } });
    assert.equal(r.estado, 200);
    assert.deepEqual(r.cuerpo, { ok: true, data: { autorizado: true, venceEl: '2026-12-31' } });
  });

  test('ejemplo 2: rechazo por vencimiento responde 200 con autorizado:false y queda en la bitácora', async () => {
    const { llamar, recepcion, admin } = await iniciar();
    const r = await llamar('POST', '/api/accesos/validar', { token: recepcion, cuerpo: { socioId: 'S-002' } });
    assert.equal(r.estado, 200);
    assert.deepEqual(r.cuerpo, { ok: true, data: { autorizado: false, motivo: 'MEMBRESIA_VENCIDA' } });
    const ultima = (await llamar('GET', '/api/accesos?limite=1', { token: admin })).cuerpo.data[0];
    assert.deepEqual(
      { ...ultima, id: undefined },
      { id: undefined, fecha: '2026-10-25', hora: '09:00:00', socioId: 'S-002', resultado: 'RECHAZADO', motivo: 'MEMBRESIA_VENCIDA', membresiaId: 'M-002', usuario: 'recepcion' },
    );
    assert.match(ultima.id, /^A-\d{3}$/);
  });

  test('cada motivo de los datos de demostración: bloqueado, suspendida, cancelada, vence hoy, sin membresía, inexistente', async () => {
    const { llamar, recepcion } = await iniciar();
    const motivo = async (socioId) => (await llamar('POST', '/api/accesos/validar', { token: recepcion, cuerpo: { socioId } })).cuerpo.data;
    assert.deepEqual(await motivo('S-004'), { autorizado: true, venceEl: '2026-10-25' }); // menor con carta, vence hoy
    assert.equal((await motivo('S-006')).motivo, 'SOCIO_BLOQUEADO');
    assert.equal((await motivo('S-007')).motivo, 'MEMBRESIA_SUSPENDIDA');
    assert.equal((await motivo('S-008')).motivo, 'MEMBRESIA_CANCELADA');
    assert.equal((await motivo('S-003')).motivo, 'SIN_MEMBRESIA');
    assert.equal((await motivo('S-999')).motivo, 'SOCIO_NO_EXISTE');
  });

  test('todo intento se registra: autorizados, rechazados y de socios inexistentes, con quién lo hizo', async () => {
    const { llamar, recepcion, admin } = await iniciar();
    const antes = (await llamar('GET', '/api/accesos?limite=500', { token: admin })).cuerpo.data.length;
    await llamar('POST', '/api/accesos/validar', { token: recepcion, cuerpo: { socioId: 'S-001' } });
    await llamar('POST', '/api/accesos/validar', { token: admin, cuerpo: { socioId: 'S-006' } });
    await llamar('POST', '/api/accesos/validar', { token: recepcion, cuerpo: { socioId: 'S-999' } });
    const despues = (await llamar('GET', '/api/accesos?limite=500', { token: admin })).cuerpo.data;
    assert.equal(despues.length, antes + 3);
    const [inexistente, bloqueado, autorizado] = despues;
    assert.deepEqual([autorizado.resultado, autorizado.membresiaId, autorizado.usuario], ['AUTORIZADO', 'M-001', 'recepcion']);
    assert.deepEqual([bloqueado.resultado, bloqueado.motivo, bloqueado.usuario], ['RECHAZADO', 'SOCIO_BLOQUEADO', 'admin']);
    assert.deepEqual([inexistente.socioId, inexistente.motivo, inexistente.membresiaId], ['S-999', 'SOCIO_NO_EXISTE', null]);
  });

  test('la bitácora se puede filtrar por resultado y socio', async () => {
    const { llamar, admin } = await iniciar();
    const rechazados = (await llamar('GET', '/api/accesos?resultado=RECHAZADO', { token: admin })).cuerpo.data;
    assert.deepEqual(rechazados.map((a) => a.id), ['A-003', 'A-002']);
    const deAna = (await llamar('GET', '/api/accesos?socioId=S-001', { token: admin })).cuerpo.data;
    assert.deepEqual(deAna.map((a) => a.id), ['A-001']);
  });
});

// ---------------------------------------------------------------------------
describe('permisos por rol', () => {
  const ENDPOINTS = [
    ['GET', '/api/socios', 'socios:consultar'],
    ['POST', '/api/socios', 'socios:crear', () => socioNuevo],
    ['GET', '/api/socios/S-001', 'socios:consultar'],
    ['GET', '/api/planes', 'planes:consultar'],
    ['POST', '/api/pagos', 'pagos:registrar', () => ({ socioId: 'S-003', planId: 'mensual', metodo: 'efectivo', monto: 450 })],
    ['POST', '/api/membresias/activar', 'membresias:activar', () => ({ socioId: 'S-003' })],
    ['POST', '/api/membresias/M-002/renovar', 'membresias:renovar', () => ({ planId: 'mensual' })],
    ['GET', '/api/membresias/S-001', 'membresias:consultar'],
    ['POST', '/api/accesos/validar', 'accesos:validar', () => ({ socioId: 'S-001' })],
    ['GET', '/api/accesos', 'accesos:bitacora'],
  ];

  test('cada endpoint responde según la tabla PERMISOS: sin sesión 401, rol sin permiso 403, con permiso nunca 401/403', async () => {
    for (const [metodo, ruta, accion, cuerpo] of ENDPOINTS) {
      for (const rol of ['recepcionista', 'administrador']) {
        const sesion = await iniciar();
        const token = rol === 'recepcionista' ? sesion.recepcion : sesion.admin;
        const r = await sesion.llamar(metodo, ruta, { token, cuerpo: cuerpo?.() });
        const permitido = PERMISOS[accion].includes(rol);
        // Con permiso, la regla de negocio puede responder 2xx o 409; lo que nunca debe aparecer es 401/403.
        if (permitido) assert.ok(r.estado !== 401 && r.estado !== 403, `${rol} debe poder ${metodo} ${ruta}: ${r.estado} ${JSON.stringify(r.cuerpo)}`);
        else esperarError(r, 403, 'SIN_PERMISO');
      }
      const anonimo = await (await iniciar()).llamar(metodo, ruta, { cuerpo: cuerpo?.() });
      esperarError(anonimo, 401, 'NO_AUTENTICADO');
    }
  });

  test('Administrador: puede todo, incluida la bitácora', async () => {
    const { llamar, admin } = await iniciar();
    assert.equal((await llamar('GET', '/api/accesos', { token: admin })).estado, 200);
    assert.equal((await llamar('POST', '/api/socios', { token: admin, cuerpo: socioNuevo })).estado, 201);
    assert.equal((await llamar('POST', '/api/accesos/validar', { token: admin, cuerpo: { socioId: 'S-001' } })).estado, 200);
  });

  test('Recepcionista: opera socios, pagos, membresías y accesos, pero no ve la bitácora', async () => {
    const { llamar, recepcion } = await iniciar();
    assert.equal((await llamar('POST', '/api/socios', { token: recepcion, cuerpo: socioNuevo })).estado, 201);
    assert.equal((await llamar('POST', '/api/pagos', { token: recepcion, cuerpo: { socioId: 'S-003', planId: 'mensual', metodo: 'efectivo', monto: 450 } })).estado, 201);
    assert.equal((await llamar('POST', '/api/membresias/activar', { token: recepcion, cuerpo: { socioId: 'S-003' } })).estado, 201);
    assert.equal((await llamar('POST', '/api/accesos/validar', { token: recepcion, cuerpo: { socioId: 'S-003' } })).estado, 200);
    esperarError(await llamar('GET', '/api/accesos', { token: recepcion }), 403, 'SIN_PERMISO');
  });

  test('un usuario desactivado pierde el acceso aunque su token no haya expirado', async () => {
    const activo = await iniciar();
    assert.equal((await activo.llamar('GET', '/api/planes', { token: activo.recepcion })).estado, 200);
    // Mismo secreto y mismo token, pero ahora el usuario figura como desactivado en los datos.
    const desactivado = structuredClone(DEMO);
    desactivado.usuarios.find((u) => u.usuario === 'recepcion').activo = false;
    const otra = await iniciar({ almacen: crearAlmacenamientoEnMemoria(desactivado) });
    esperarError(await otra.llamar('GET', '/api/planes', { token: activo.recepcion }), 401, 'TOKEN_INVALIDO');
    esperarError(await otra.llamar('POST', '/api/auth/login', { cuerpo: { usuario: 'recepcion', contrasena: 'Recep#2026' } }), 401, 'CREDENCIALES_INVALIDAS');
  });
});

// ---------------------------------------------------------------------------
describe('diseño: dependencias inyectadas (DIP/OCP)', () => {
  test('los planes salen de los datos persistidos: un plan nuevo funciona sin cambiar código', async () => {
    const datos = structuredClone(DEMO);
    datos.planes.push({ id: 'semestral', nombre: 'Semestral', precio: 2200, duracionDias: 180, disponible: true });
    const { llamar, recepcion } = await iniciar({ almacen: crearAlmacenamientoEnMemoria(datos) });
    assert.equal((await llamar('GET', '/api/planes', { token: recepcion })).cuerpo.data.length, 3);
    await llamar('POST', '/api/pagos', { token: recepcion, cuerpo: { socioId: 'S-003', planId: 'semestral', metodo: 'efectivo', monto: 2200 } });
    const r = await llamar('POST', '/api/membresias/activar', { token: recepcion, cuerpo: { socioId: 'S-003' } });
    assert.equal(r.cuerpo.data.vencimiento, '2027-04-23'); // 2026-10-25 + 180 días
  });

  test('un cambio de tarifa en los datos se aplica de inmediato; un plan no disponible no se puede pagar', async () => {
    const datos = structuredClone(DEMO);
    datos.planes.find((p) => p.id === 'mensual').precio = 500;
    datos.planes.find((p) => p.id === 'trimestral').disponible = false;
    const { llamar, recepcion } = await iniciar({ almacen: crearAlmacenamientoEnMemoria(datos) });
    esperarError(await llamar('POST', '/api/pagos', { token: recepcion, cuerpo: { socioId: 'S-003', planId: 'mensual', metodo: 'efectivo', monto: 450 } }), 409, 'MONTO_INCORRECTO');
    assert.equal((await llamar('POST', '/api/pagos', { token: recepcion, cuerpo: { socioId: 'S-003', planId: 'mensual', metodo: 'efectivo', monto: 500 } })).estado, 201);
    esperarError(await llamar('POST', '/api/pagos', { token: recepcion, cuerpo: { socioId: 'S-003', planId: 'trimestral', metodo: 'efectivo', monto: 1200 } }), 409, 'PLAN_NO_DISPONIBLE');
  });

  test('la API acepta cualquier objeto que cumpla el contrato (aquí, uno que cuenta las operaciones)', async () => {
    const real = crearAlmacenamientoEnMemoria(DEMO);
    const llamadas = [];
    const registrar = (nombre, f) => (...args) => (llamadas.push(nombre), f(...args));
    const envuelto = {
      lectura: Object.fromEntries(Object.entries(real.lectura).map(([n, f]) => [n, registrar(`lectura.${n}`, f)])),
      transaccion: (fn) => real.transaccion((tx) => fn(Object.fromEntries(Object.entries(tx).map(([n, f]) => [n, registrar(`tx.${n}`, f)])))),
    };
    const { llamar, recepcion } = await iniciar({ almacen: envuelto });
    await llamar('GET', '/api/planes', { token: recepcion });
    await llamar('POST', '/api/accesos/validar', { token: recepcion, cuerpo: { socioId: 'S-001' } });
    assert.ok(llamadas.includes('lectura.listar'));
    assert.ok(llamadas.includes('tx.insertar'));
  });

  test('el reloj inyectado decide el "hoy": la misma membresía cambia de resultado al mover la fecha', async () => {
    const { llamar, recepcion, reloj } = await iniciar();
    const validar = async () => (await llamar('POST', '/api/accesos/validar', { token: recepcion, cuerpo: { socioId: 'S-004' } })).cuerpo.data;
    reloj.fecha = '2026-10-25';
    assert.equal((await validar()).autorizado, true); // vence hoy
    reloj.fecha = '2026-10-26';
    assert.equal((await validar()).motivo, 'MEMBRESIA_VENCIDA');
    reloj.fecha = '2026-09-24';
    assert.equal((await validar()).motivo, 'MEMBRESIA_NO_INICIADA');
  });
});

// ---------------------------------------------------------------------------
// Contrato de almacenamiento: la MISMA batería se ejecuta sobre cada implementación (LSP).
// ---------------------------------------------------------------------------
const IMPLEMENTACIONES = {
  'memoria': () => crearAlmacenamientoEnMemoria(DEMO),
  'archivo JSON': () => {
    const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'sacg-'));
    carpetas.push(carpeta);
    return crearAlmacenamientoArchivo({ ruta: path.join(carpeta, 'datos.json'), rutaSemilla: RUTA_DEMO });
  },
};

for (const [nombre, crear] of Object.entries(IMPLEMENTACIONES)) {
  describe(`contrato de almacenamiento (${nombre})`, () => {
    test('lectura: listar, obtener y buscar; inexistente => null o []', async () => {
      const { lectura } = crear();
      assert.equal((await lectura.listar('socios')).length, DEMO.socios.length);
      assert.equal((await lectura.obtener('socios', 'S-001')).nombre, 'Ana');
      assert.equal(await lectura.obtener('socios', 'S-999'), null);
      assert.deepEqual((await lectura.buscar('membresias', { socioId: 'S-002' })).map((m) => m.id), ['M-002']);
      assert.deepEqual(await lectura.buscar('membresias', { socioId: 'S-003' }), []);
      assert.deepEqual((await lectura.buscar('pagos', { socioId: 'S-002', aplicado: false })).map((p) => p.id), ['P-005']);
    });

    test('insertar asigna ids consecutivos por colección; actualizar cambia solo lo indicado', async () => {
      const almacen = crear();
      const [a, b] = await almacen.transaccion(async (tx) => [await tx.insertar('socios', { nombre: 'X' }), await tx.insertar('socios', { nombre: 'Y' })]);
      assert.deepEqual([a.id, b.id], ['S-009', 'S-010']);
      const cambiado = await almacen.transaccion((tx) => tx.actualizar('socios', 'S-001', { telefono: '5599999999' }));
      assert.equal(cambiado.telefono, '5599999999');
      assert.equal(cambiado.nombre, 'Ana');
      assert.equal((await almacen.lectura.obtener('socios', 'S-001')).telefono, '5599999999');
    });

    test('actualizar un registro inexistente lanza ErrorAlmacenamiento NO_EXISTE y no guarda nada', async () => {
      const almacen = crear();
      await assert.rejects(
        almacen.transaccion(async (tx) => {
          await tx.insertar('socios', { nombre: 'Fantasma' });
          await tx.actualizar('socios', 'S-777', { nombre: 'Z' });
        }),
        (e) => e instanceof ErrorAlmacenamiento && e.codigo === 'NO_EXISTE',
      );
      assert.equal((await almacen.lectura.listar('socios')).length, DEMO.socios.length);
    });

    test('colección desconocida => ErrorAlmacenamiento COLECCION_DESCONOCIDA', async () => {
      const { lectura } = crear();
      await assert.rejects(async () => lectura.listar('inventada'), (e) => e.codigo === 'COLECCION_DESCONOCIDA');
    });

    test('atomicidad: si la transacción lanza, no se guarda nada; la lectura solo ve lo confirmado', async () => {
      const almacen = crear();
      let vistoDentro;
      await assert.rejects(
        almacen.transaccion(async (tx) => {
          await tx.insertar('socios', { nombre: 'Temporal' });
          vistoDentro = (await tx.listar('socios')).length;
          assert.equal((await almacen.lectura.listar('socios')).length, DEMO.socios.length);
          throw new Error('falla a medias');
        }),
        /falla a medias/,
      );
      assert.equal(vistoDentro, DEMO.socios.length + 1);
      assert.equal((await almacen.lectura.listar('socios')).length, DEMO.socios.length);
      // y la siguiente transacción sigue funcionando y reutiliza el mismo id
      assert.equal((await almacen.transaccion((tx) => tx.insertar('socios', { nombre: 'Real' }))).id, 'S-009');
    });

    test('los registros devueltos son copias: modificarlos no altera lo guardado', async () => {
      const { lectura } = crear();
      const ana = await lectura.obtener('socios', 'S-001');
      ana.nombre = 'Modificado';
      (await lectura.listar('socios'))[0].nombre = 'Otro';
      assert.equal((await lectura.obtener('socios', 'S-001')).nombre, 'Ana');
    });

    test('transacciones concurrentes se serializan: dos pagos simultáneos no repiten id', async () => {
      const almacen = crear();
      const ids = await Promise.all(Array.from({ length: 5 }, (_, i) => almacen.transaccion(async (tx) => (await tx.insertar('pagos', { n: i })).id)));
      assert.equal(new Set(ids).size, 5);
    });
  });
}

describe('almacenamiento en archivo JSON', () => {
  test('persiste entre reinicios, parte de una copia de la semilla y no toca datosDemo.json', async () => {
    const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'sacg-'));
    carpetas.push(carpeta);
    const ruta = path.join(carpeta, 'sub', 'datos.json');
    const primero = crearAlmacenamientoArchivo({ ruta, rutaSemilla: RUTA_DEMO });
    await primero.transaccion((tx) => tx.insertar('socios', { nombre: 'Persistente' }));
    const segundo = crearAlmacenamientoArchivo({ ruta, rutaSemilla: RUTA_DEMO });
    assert.equal((await segundo.lectura.obtener('socios', 'S-009')).nombre, 'Persistente');
    assert.equal(fs.existsSync(`${ruta}.tmp`), false);
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(RUTA_DEMO)).digest('hex'), HASH_DEMO_ORIGINAL);
  });

  test('sin archivo ni semilla falla con un mensaje claro', () => {
    assert.throws(() => crearAlmacenamientoArchivo({ ruta: path.join(os.tmpdir(), 'no-existe-sacg', 'x.json') }), /semilla/);
  });

  test('la API completa funciona sobre el archivo JSON y deja los cambios en disco', async () => {
    const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'sacg-'));
    carpetas.push(carpeta);
    const ruta = path.join(carpeta, 'datos.json');
    const { llamar, recepcion } = await iniciar({ almacen: crearAlmacenamientoArchivo({ ruta, rutaSemilla: RUTA_DEMO }) });
    await llamar('POST', '/api/accesos/validar', { token: recepcion, cuerpo: { socioId: 'S-001' } });
    const enDisco = JSON.parse(fs.readFileSync(ruta, 'utf8'));
    assert.equal(enDisco.accesos.length, DEMO.accesos.length + 1);
    assert.equal(enDisco.accesos.at(-1).socioId, 'S-001');
  });
});

describe('datos de demostración', () => {
  test('incluyen los casos pedidos: autorizado, vencido, sin pago, bloqueado y accesos autorizados y rechazados', () => {
    assert.ok(DEMO.socios.some((s) => s.estado === 'bloqueado'));
    assert.ok(DEMO.accesos.some((a) => a.resultado === 'AUTORIZADO'));
    assert.ok(DEMO.accesos.some((a) => a.resultado === 'RECHAZADO'));
    assert.ok(DEMO.planes.every((p) => p.origen === 'SUPUESTO'), 'los planes no documentados están marcados como SUPUESTO');
    const sinPago = DEMO.socios.find((s) => s.id === 'S-003');
    assert.equal(DEMO.pagos.some((p) => p.socioId === sinPago.id), false);
  });
});
