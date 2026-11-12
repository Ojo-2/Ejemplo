// Pruebas unitarias de reglasNegocio.js. Sin servidor, sin disco y sin reloj real:
// "hoy" siempre se pasa como parámetro.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  activarMembresia,
  autorizarAcceso,
  calcularEdad,
  construirRegistroAcceso,
  diferenciaDias,
  estadoHttp,
  esBisiesto,
  filtrarBitacora,
  filtrarSocios,
  MOTIVOS_RECHAZO,
  parsearFecha,
  renovarMembresia,
  seleccionarPagoPendiente,
  sumarDias,
  validarFiltrosBitacora,
  validarPago,
  validarSocio,
  validarSolicitudAcceso,
  validarSolicitudActivacion,
  validarSolicitudRenovacion,
  verificarPagoAplicable,
  vigenciaMembresia,
  vistaMembresia,
} from '../reglasNegocio.js';

const HOY = '2026-10-25';
const MENSUAL = { id: 'mensual', nombre: 'Mensual', precio: 450, duracionDias: 30, disponible: true };
const TRIMESTRAL = { id: 'trimestral', nombre: 'Trimestral', precio: 1200, duracionDias: 90, disponible: true };
const socio = (extra = {}) => ({ id: 'S-001', nombre: 'Ana', apellidos: 'Torres López', fechaNacimiento: '1994-02-14', cartaResponsiva: false, estado: 'activo', ...extra });
const membresia = (extra = {}) => ({ id: 'M-001', socioId: 'S-001', planId: 'mensual', estado: 'activa', inicio: '2026-10-01', vencimiento: '2026-10-31', ...extra });
const pago = (extra = {}) => ({ id: 'P-001', socioId: 'S-001', planId: 'mensual', monto: 450, estado: 'confirmado', aplicado: false, fecha: '2026-10-25', hora: '10:00:00', ...extra });
const decision = (ctx) => autorizarAcceso({ hoy: HOY, ...ctx }).data;
const solicitudValida = { nombre: 'Rosa', apellidos: 'Vega Luna', telefono: '5511112222', correo: 'rosa@example.com', fechaNacimiento: '1995-06-20' };

describe('resultado uniforme', () => {
  test('toda validación devuelve { ok, data } o { ok, error } y estadoHttp lo traduce', () => {
    const bueno = validarSocio(solicitudValida, { hoy: HOY });
    assert.equal(bueno.ok, true);
    assert.equal(estadoHttp(bueno, 201), 201);
    const malo = validarSocio({}, { hoy: HOY });
    assert.equal(malo.ok, false);
    assert.equal(malo.error.codigo, 'DATOS_INVALIDOS');
    assert.equal(estadoHttp(malo), 400);
  });
});

describe('fechas', () => {
  test('rechaza fechas inexistentes y acepta 29-feb solo en año bisiesto', () => {
    assert.equal(parsearFecha('2025-02-29'), null);
    assert.deepEqual(parsearFecha('2024-02-29'), { anio: 2024, mes: 2, dia: 29 });
    assert.equal(parsearFecha('2026-13-01'), null);
    assert.equal(parsearFecha('25/10/2026'), null);
    assert.equal(esBisiesto(1900), false);
    assert.equal(esBisiesto(2000), true);
  });

  test('calcularEdad respeta el cumpleaños y el 29-feb', () => {
    assert.equal(calcularEdad('2008-10-26', HOY), 17);
    assert.equal(calcularEdad('2008-10-25', HOY), 18);
    assert.equal(calcularEdad('2008-02-29', '2026-02-28'), 17);
    assert.equal(calcularEdad('2008-02-29', '2026-03-01'), 18);
  });
});

describe('vigencia: vence hoy, vencida y todavía no inicia', () => {
  test('membresía que vence hoy: sigue vigente y entra (vencimiento inclusivo)', () => {
    const m = membresia({ vencimiento: HOY });
    assert.equal(vigenciaMembresia(m, HOY), 'vigente');
    assert.deepEqual(decision({ socio: socio(), membresia: m }), { autorizado: true, venceEl: HOY });
    assert.equal(vistaMembresia(m, HOY).diasRestantes, 0);
  });

  test('el día siguiente al vencimiento ya está vencida y se rechaza', () => {
    const m = membresia({ vencimiento: '2026-10-24' });
    assert.equal(vigenciaMembresia(m, HOY), 'vencida');
    assert.deepEqual(decision({ socio: socio(), membresia: m }), { autorizado: false, motivo: 'MEMBRESIA_VENCIDA' });
  });

  test('membresía que todavía no inicia: se rechaza con MEMBRESIA_NO_INICIADA', () => {
    const m = membresia({ inicio: '2026-10-26', vencimiento: '2026-11-25' });
    assert.equal(vigenciaMembresia(m, HOY), 'no_iniciada');
    assert.deepEqual(decision({ socio: socio(), membresia: m }), { autorizado: false, motivo: 'MEMBRESIA_NO_INICIADA' });
  });

  test('el día de inicio ya cuenta como vigente', () => {
    assert.equal(vigenciaMembresia(membresia({ inicio: HOY, vencimiento: '2026-11-24' }), HOY), 'vigente');
  });
});

describe('reglas de acceso', () => {
  test('socio inexistente: SOCIO_NO_EXISTE', () => {
    assert.deepEqual(decision({ socio: null, membresia: null }), { autorizado: false, motivo: 'SOCIO_NO_EXISTE' });
  });

  test('socio bloqueado: SOCIO_BLOQUEADO aunque tenga membresía vigente', () => {
    assert.deepEqual(decision({ socio: socio({ estado: 'bloqueado' }), membresia: membresia() }), { autorizado: false, motivo: 'SOCIO_BLOQUEADO' });
  });

  test('membresía suspendida: MEMBRESIA_SUSPENDIDA aunque las fechas estén vigentes', () => {
    assert.deepEqual(decision({ socio: socio(), membresia: membresia({ estado: 'suspendida' }) }), { autorizado: false, motivo: 'MEMBRESIA_SUSPENDIDA' });
  });

  test('membresía cancelada: MEMBRESIA_CANCELADA aunque las fechas estén vigentes', () => {
    assert.deepEqual(decision({ socio: socio(), membresia: membresia({ estado: 'cancelada' }) }), { autorizado: false, motivo: 'MEMBRESIA_CANCELADA' });
  });

  test('sin membresía: SIN_MEMBRESIA', () => {
    assert.deepEqual(decision({ socio: socio(), membresia: null }), { autorizado: false, motivo: 'SIN_MEMBRESIA' });
  });

  test('menor sin Carta Responsiva: CARTA_RESPONSIVA_PENDIENTE; con carta, entra', () => {
    const menor = { fechaNacimiento: '2010-05-14' };
    assert.deepEqual(decision({ socio: socio(menor), membresia: membresia() }), { autorizado: false, motivo: 'CARTA_RESPONSIVA_PENDIENTE' });
    assert.equal(decision({ socio: socio({ ...menor, cartaResponsiva: true }), membresia: membresia() }).autorizado, true);
  });

  test('el socio bloqueado se evalúa antes que la membresía (orden estable de motivos)', () => {
    const d = decision({ socio: socio({ estado: 'bloqueado' }), membresia: membresia({ estado: 'cancelada', vencimiento: '2020-01-01' }) });
    assert.equal(d.motivo, 'SOCIO_BLOQUEADO');
  });

  test('todos los motivos devueltos pertenecen a la lista estable', () => {
    for (const motivo of ['SOCIO_NO_EXISTE', 'SOCIO_BLOQUEADO', 'SIN_MEMBRESIA', 'MEMBRESIA_NO_INICIADA', 'MEMBRESIA_VENCIDA', 'MEMBRESIA_SUSPENDIDA', 'MEMBRESIA_CANCELADA']) {
      assert.ok(MOTIVOS_RECHAZO.includes(motivo), motivo);
    }
  });

  test('se puede agregar una regla nueva sin modificar las existentes (OCP)', () => {
    const sinLunes = { motivo: 'CERRADO_POR_EVENTO', objeta: ({ hoy }) => hoy === HOY };
    const r = autorizarAcceso({ socio: socio(), membresia: membresia(), hoy: HOY }, [sinLunes]);
    assert.deepEqual(r.data, { autorizado: false, motivo: 'CERRADO_POR_EVENTO' });
  });

  test('construirRegistroAcceso arma la entrada de la bitácora', () => {
    const base = { socioId: 'S-001', membresia: membresia(), usuario: 'recepcion', fecha: HOY, hora: '08:00:00' };
    assert.deepEqual(construirRegistroAcceso({ ...base, decision: { autorizado: true, venceEl: '2026-10-31' } }), {
      fecha: HOY, hora: '08:00:00', socioId: 'S-001', resultado: 'AUTORIZADO', motivo: null, membresiaId: 'M-001', usuario: 'recepcion',
    });
    const rechazo = construirRegistroAcceso({ ...base, membresia: null, decision: { autorizado: false, motivo: 'SIN_MEMBRESIA' } });
    assert.equal(rechazo.resultado, 'RECHAZADO');
    assert.equal(rechazo.motivo, 'SIN_MEMBRESIA');
    assert.equal(rechazo.membresiaId, null);
  });
});

describe('activación y pagos', () => {
  test('activación sin pago: PAGO_REQUERIDO', () => {
    const r = activarMembresia({ socio: socio(), membresia: null, pago: null, plan: null, hoy: HOY });
    assert.equal(r.ok, false);
    assert.equal(r.error.codigo, 'PAGO_REQUERIDO');
    assert.equal(r.error.mensaje, 'No se puede activar una membresía sin pago.');
    assert.equal(estadoHttp(r), 409);
  });

  test('activación con pago válido: inicia hoy y vence a inicio + duración', () => {
    const r = activarMembresia({ socio: socio(), membresia: null, pago: pago(), plan: MENSUAL, hoy: HOY });
    assert.equal(r.ok, true);
    assert.deepEqual(r.data, { socioId: 'S-001', planId: 'mensual', pagoId: 'P-001', estado: 'activa', inicio: HOY, vencimiento: '2026-11-24' });
  });

  test('no se activa dos veces: MEMBRESIA_EXISTENTE', () => {
    const r = activarMembresia({ socio: socio(), membresia: membresia(), pago: pago(), plan: MENSUAL, hoy: HOY });
    assert.equal(r.error.codigo, 'MEMBRESIA_EXISTENTE');
  });

  test('pago de otro socio: PAGO_NO_PERTENECE_AL_SOCIO', () => {
    const r = activarMembresia({ socio: socio(), membresia: null, pago: pago({ socioId: 'S-002' }), plan: MENSUAL, hoy: HOY });
    assert.equal(r.error.codigo, 'PAGO_NO_PERTENECE_AL_SOCIO');
  });

  test('pago ya utilizado: PAGO_YA_UTILIZADO', () => {
    const r = activarMembresia({ socio: socio(), membresia: null, pago: pago({ aplicado: true }), plan: MENSUAL, hoy: HOY });
    assert.equal(r.error.codigo, 'PAGO_YA_UTILIZADO');
  });

  test('monto incorrecto (la tarifa cambió después del pago): MONTO_INCORRECTO', () => {
    const r = activarMembresia({ socio: socio(), membresia: null, pago: pago({ monto: 400 }), plan: MENSUAL, hoy: HOY });
    assert.equal(r.error.codigo, 'MONTO_INCORRECTO');
  });

  test('pago de otro plan: PAGO_NO_CORRESPONDE_AL_PLAN', () => {
    const r = verificarPagoAplicable(pago({ planId: 'trimestral' }), { socioId: 'S-001', plan: MENSUAL });
    assert.equal(r.error.codigo, 'PAGO_NO_CORRESPONDE_AL_PLAN');
  });

  test('validarPago: monto igual a la tarifa vigente, socio y plan existentes', () => {
    const entrada = { socioId: 'S-001', planId: 'mensual', metodo: 'efectivo', monto: 450 };
    const bueno = validarPago(entrada, { socio: socio(), plan: MENSUAL });
    assert.deepEqual(bueno.data, { socioId: 'S-001', planId: 'mensual', monto: 450, metodo: 'efectivo', concepto: 'ALTA' });
    assert.equal(validarPago(entrada, { socio: socio(), plan: MENSUAL, membresia: membresia() }).data.concepto, 'RENOVACION');
    assert.equal(validarPago({ ...entrada, monto: 449.99 }, { socio: socio(), plan: MENSUAL }).error.codigo, 'MONTO_INCORRECTO');
    assert.equal(validarPago(entrada, { socio: null, plan: MENSUAL }).error.codigo, 'SOCIO_NO_EXISTE');
    assert.equal(validarPago(entrada, { socio: socio(), plan: null }).error.codigo, 'PLAN_NO_EXISTE');
    assert.equal(validarPago(entrada, { socio: socio(), plan: { ...MENSUAL, disponible: false } }).error.codigo, 'PLAN_NO_DISPONIBLE');
  });

  test('validarPago: datos obligatorios y método inválido => DATOS_INVALIDOS con detalle por campo', () => {
    const r = validarPago({ socioId: 'S-001', metodo: 'bitcoin' }, {});
    assert.equal(r.error.codigo, 'DATOS_INVALIDOS');
    assert.deepEqual(Object.keys(r.error.detalle).sort(), ['metodo', 'monto', 'planId']);
  });

  test('seleccionarPagoPendiente toma el más antiguo sin aplicar del socio', () => {
    const pagos = [
      pago({ id: 'P-003', fecha: '2026-10-20' }),
      pago({ id: 'P-002', fecha: '2026-10-10' }),
      pago({ id: 'P-001', aplicado: true, fecha: '2026-10-01' }),
      pago({ id: 'P-009', socioId: 'S-002', fecha: '2026-09-01' }),
    ];
    assert.equal(seleccionarPagoPendiente(pagos, { socioId: 'S-001' }).data.id, 'P-002');
    assert.equal(seleccionarPagoPendiente(pagos, { socioId: 'S-001', planId: 'trimestral' }).data, null);
    assert.equal(seleccionarPagoPendiente(pagos, { socioId: 'S-777' }).data, null);
  });
});

describe('renovación', () => {
  test('renovación anticipada: los días se suman al vencimiento actual y se conserva el inicio', () => {
    const m = membresia({ inicio: '2026-10-01', vencimiento: '2026-10-31' });
    const r = renovarMembresia({ membresia: m, pago: pago(), plan: MENSUAL, hoy: HOY });
    assert.equal(r.data.tipo, 'ACUMULADA');
    assert.equal(r.data.desde, '2026-10-31');
    assert.equal(r.data.inicio, '2026-10-01');
    assert.equal(r.data.vencimiento, '2026-11-30');
  });

  test('renovar el mismo día del vencimiento también acumula', () => {
    const r = renovarMembresia({ membresia: membresia({ vencimiento: HOY }), pago: pago(), plan: MENSUAL, hoy: HOY });
    assert.equal(r.data.tipo, 'ACUMULADA');
    assert.equal(r.data.vencimiento, '2026-11-24');
  });

  test('renovación vencida: el periodo empieza hoy y se cuenta desde hoy', () => {
    const m = membresia({ inicio: '2026-08-31', vencimiento: '2026-09-30' });
    const r = renovarMembresia({ membresia: m, pago: pago(), plan: MENSUAL, hoy: HOY });
    assert.equal(r.data.tipo, 'DESDE_HOY');
    assert.equal(r.data.inicio, HOY);
    assert.equal(r.data.vencimientoAnterior, '2026-09-30');
    assert.equal(r.data.vencimiento, '2026-11-24');
  });

  test('cambio de plan: la nueva duración es la del plan elegido', () => {
    const m = membresia({ planId: 'mensual', vencimiento: '2026-10-31' });
    const p = pago({ planId: 'trimestral', monto: 1200 });
    const r = renovarMembresia({ membresia: m, pago: p, plan: TRIMESTRAL, hoy: HOY });
    assert.equal(r.data.planId, 'trimestral');
    assert.equal(r.data.vencimiento, '2027-01-29'); // 2026-10-31 + 90 días
  });

  test('cambio de mes: 2026-01-31 + 30 días = 2026-03-02 (febrero tiene 28)', () => {
    const m = membresia({ inicio: '2026-01-01', vencimiento: '2026-01-31' });
    const r = renovarMembresia({ membresia: m, pago: pago(), plan: MENSUAL, hoy: '2026-01-20' });
    assert.equal(r.data.vencimiento, '2026-03-02');
  });

  test('cambio de año: se cruza el 31-dic sin errores', () => {
    const r = activarMembresia({ socio: socio(), membresia: null, pago: pago(), plan: MENSUAL, hoy: '2026-12-15' });
    assert.equal(r.data.vencimiento, '2027-01-14');
    assert.equal(sumarDias('2026-12-31', 1), '2027-01-01');
  });

  test('año bisiesto: 2028-02-10 + 30 días = 2028-03-11, y 2027-02-10 + 30 = 2027-03-12', () => {
    assert.equal(activarMembresia({ socio: socio(), membresia: null, pago: pago(), plan: MENSUAL, hoy: '2028-02-10' }).data.vencimiento, '2028-03-11');
    assert.equal(activarMembresia({ socio: socio(), membresia: null, pago: pago(), plan: MENSUAL, hoy: '2027-02-10' }).data.vencimiento, '2027-03-12');
    assert.equal(sumarDias('2028-02-28', 1), '2028-02-29');
    assert.equal(diferenciaDias('2028-02-28', '2028-03-01'), 2);
  });

  test('renovar exige pago válido: sin pago, de otro socio, usado o de otro plan', () => {
    const base = { membresia: membresia(), plan: MENSUAL, hoy: HOY };
    assert.equal(renovarMembresia({ ...base, pago: null }).error.codigo, 'PAGO_REQUERIDO');
    assert.equal(renovarMembresia({ ...base, pago: pago({ socioId: 'S-002' }) }).error.codigo, 'PAGO_NO_PERTENECE_AL_SOCIO');
    assert.equal(renovarMembresia({ ...base, pago: pago({ aplicado: true }) }).error.codigo, 'PAGO_YA_UTILIZADO');
    assert.equal(renovarMembresia({ ...base, pago: pago({ planId: 'trimestral', monto: 1200 }) }).error.codigo, 'PAGO_NO_CORRESPONDE_AL_PLAN');
    assert.equal(renovarMembresia({ ...base, pago: pago({ monto: 1 }) }).error.codigo, 'MONTO_INCORRECTO');
    assert.equal(renovarMembresia({ ...base, plan: null, pago: pago() }).error.codigo, 'PLAN_NO_EXISTE');
  });

  test('no se renuevan membresías suspendidas ni canceladas', () => {
    const base = { pago: pago(), plan: MENSUAL, hoy: HOY };
    assert.equal(renovarMembresia({ ...base, membresia: membresia({ estado: 'suspendida' }) }).error.codigo, 'MEMBRESIA_SUSPENDIDA');
    assert.equal(renovarMembresia({ ...base, membresia: membresia({ estado: 'cancelada' }) }).error.codigo, 'MEMBRESIA_CANCELADA');
  });
});

describe('datos del socio', () => {
  test('datos obligatorios: faltan todos => detalle por campo', () => {
    const r = validarSocio({}, { hoy: HOY });
    assert.equal(r.error.codigo, 'DATOS_INVALIDOS');
    assert.deepEqual(Object.keys(r.error.detalle).sort(), ['apellidos', 'fechaNacimiento', 'nombre', 'telefono']);
  });

  test('formatos inválidos: nombre, teléfono, correo y fecha', () => {
    const r = validarSocio(
      { nombre: 'R0sa', apellidos: 'Vega', telefono: '123', correo: 'sin-arroba', fechaNacimiento: '2025-02-30' },
      { hoy: HOY },
    );
    assert.deepEqual(Object.keys(r.error.detalle).sort(), ['correo', 'fechaNacimiento', 'nombre', 'telefono']);
    assert.equal(r.error.detalle.correo, 'El correo no tiene un formato válido.');
    assert.equal(validarSocio({ ...solicitudValida, fechaNacimiento: '2030-01-01' }, { hoy: HOY }).error.detalle.fechaNacimiento, 'La fecha de nacimiento no puede ser futura.');
  });

  test('socio válido: normaliza texto, correo y teléfono, y queda activo', () => {
    const r = validarSocio({ ...solicitudValida, nombre: '  rosa  ', correo: 'ROSA@Example.com', telefono: '55 1111-2222' }, { hoy: HOY });
    assert.equal(r.ok, true);
    assert.equal(r.data.correo, 'rosa@example.com');
    assert.equal(r.data.telefono, '5511112222');
    assert.equal(r.data.estado, 'activo');
  });

  test('menor de 18 sin Carta Responsiva es inválido; con carta, válido', () => {
    const menor = { ...solicitudValida, correo: undefined, fechaNacimiento: '2012-01-01' };
    assert.equal(validarSocio(menor, { hoy: HOY }).error.detalle.cartaResponsiva !== undefined, true);
    assert.equal(validarSocio({ ...menor, cartaResponsiva: true }, { hoy: HOY }).ok, true);
  });

  test('socio duplicado: mismo correo, o mismo nombre + apellidos + nacimiento (sin acentos)', () => {
    const existentes = [{ id: 'S-001', nombre: 'Rosa', apellidos: 'Vega Luna', correo: 'rosa@example.com', fechaNacimiento: '1995-06-20' }];
    const porCorreo = validarSocio({ ...solicitudValida, nombre: 'Otra', apellidos: 'Persona', fechaNacimiento: '1980-01-01' }, { socios: existentes, hoy: HOY });
    assert.equal(porCorreo.error.codigo, 'SOCIO_DUPLICADO');
    assert.equal(estadoHttp(porCorreo), 409);
    const porIdentidad = validarSocio({ ...solicitudValida, correo: 'distinto@example.com', nombre: 'RÓSA' }, { socios: existentes, hoy: HOY });
    assert.equal(porIdentidad.error.codigo, 'SOCIO_DUPLICADO');
  });

  test('filtrarSocios busca por id, nombre o apellidos sin importar acentos', () => {
    const lista = [socio(), socio({ id: 'S-002', nombre: 'Luis', apellidos: 'Ramírez Soto' })];
    assert.deepEqual(filtrarSocios(lista, 'ramirez').map((s) => s.id), ['S-002']);
    assert.deepEqual(filtrarSocios(lista, 's-001').map((s) => s.id), ['S-001']);
    assert.equal(filtrarSocios(lista, '').length, 2);
  });
});

describe('solicitudes y bitácora', () => {
  test('validación de solicitudes: socioId, pagoId y planId', () => {
    assert.equal(validarSolicitudAcceso({}).error.codigo, 'DATOS_INVALIDOS');
    assert.equal(validarSolicitudAcceso({ socioId: 'S-001' }).ok, true);
    assert.equal(validarSolicitudActivacion({ socioId: 'S-001', pagoId: 5 }).error.detalle.pagoId !== undefined, true);
    assert.equal(validarSolicitudRenovacion({}).error.detalle.planId !== undefined, true);
    assert.deepEqual(validarSolicitudRenovacion({ planId: 'mensual' }).data, { planId: 'mensual', pagoId: undefined });
  });

  test('filtros de bitácora: validan, filtran y ordenan del más reciente al más antiguo', () => {
    const accesos = [
      { id: 'A-001', fecha: '2026-10-20', hora: '08:00:00', socioId: 'S-001', resultado: 'AUTORIZADO' },
      { id: 'A-002', fecha: '2026-10-21', hora: '09:00:00', socioId: 'S-002', resultado: 'RECHAZADO' },
      { id: 'A-003', fecha: '2026-10-21', hora: '10:00:00', socioId: 'S-001', resultado: 'RECHAZADO' },
    ];
    assert.deepEqual(filtrarBitacora(accesos).map((a) => a.id), ['A-003', 'A-002', 'A-001']);
    assert.deepEqual(filtrarBitacora(accesos, { resultado: 'RECHAZADO', socioId: 'S-001' }).map((a) => a.id), ['A-003']);
    assert.deepEqual(filtrarBitacora(accesos, { limite: 1 }).map((a) => a.id), ['A-003']);
    assert.equal(validarFiltrosBitacora({ resultado: 'X' }).error.codigo, 'DATOS_INVALIDOS');
    assert.equal(validarFiltrosBitacora({ desde: '2026-02-30' }).ok, false);
    assert.equal(validarFiltrosBitacora({ limite: '0' }).ok, false);
    assert.deepEqual(validarFiltrosBitacora({ limite: '5', resultado: 'AUTORIZADO' }).data, { limite: 5, resultado: 'AUTORIZADO' });
  });
});
