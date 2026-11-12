// Reglas de negocio del SACG: JavaScript puro.
// Sin Express, sin req/res, sin acceso a disco y sin conocer almacenamiento.js.
//
// Toda función de validación o decisión devuelve { ok, data, error } (ver `ok` y `fallo`).
// Las fechas son cadenas 'AAAA-MM-DD' y "hoy" siempre llega como parámetro: así las reglas
// son deterministas y se prueban sin depender del reloj del equipo.
//
// Convención de fechas del negocio (ver README, "Supuestos"):
//   - El VENCIMIENTO ES INCLUSIVO: es el último día en que la membresía permite entrar.
//   - vencimiento = inicio + duracionDias del plan.

// ---------------------------------------------------------------------------
// Resultado uniforme y catálogo de errores
// ---------------------------------------------------------------------------

export const ok = (data) => ({ ok: true, data });

export const fallo = (codigo, mensaje, detalle) => ({
  ok: false,
  error: detalle ? { codigo, mensaje, detalle } : { codigo, mensaje },
});

/** Código HTTP asociado a cada código de error estable. Un código desconocido se trata como 400. */
export const ESTADO_HTTP = {
  DATOS_INVALIDOS: 400,
  JSON_INVALIDO: 400,
  NO_AUTENTICADO: 401,
  TOKEN_INVALIDO: 401,
  CREDENCIALES_INVALIDAS: 401,
  SIN_PERMISO: 403,
  SOCIO_NO_EXISTE: 404,
  PLAN_NO_EXISTE: 404,
  PAGO_NO_EXISTE: 404,
  MEMBRESIA_NO_EXISTE: 404,
  RUTA_NO_ENCONTRADA: 404,
  SOCIO_DUPLICADO: 409,
  PLAN_NO_DISPONIBLE: 409,
  PAGO_REQUERIDO: 409,
  PAGO_NO_PERTENECE_AL_SOCIO: 409,
  PAGO_NO_CORRESPONDE_AL_PLAN: 409,
  PAGO_YA_UTILIZADO: 409,
  MONTO_INCORRECTO: 409,
  MEMBRESIA_EXISTENTE: 409,
  MEMBRESIA_SUSPENDIDA: 409,
  MEMBRESIA_CANCELADA: 409,
  CUERPO_DEMASIADO_GRANDE: 413,
  ERROR_INTERNO: 500,
};

/** Código HTTP de un resultado. `exito` es el código a usar cuando resultado.ok es true. */
export const estadoHttp = (resultado, exito = 200) =>
  resultado.ok ? exito : (ESTADO_HTTP[resultado.error.codigo] ?? 400);

const datosInvalidos = (detalle, mensaje = 'Los datos proporcionados no son válidos.') =>
  fallo('DATOS_INVALIDOS', mensaje, detalle);

// ---------------------------------------------------------------------------
// Fechas (fechas de calendario, calculadas en UTC para evitar saltos de horario)
// ---------------------------------------------------------------------------

const RE_FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_DIA = 86_400_000;

export const esBisiesto = (anio) => (anio % 4 === 0 && anio % 100 !== 0) || anio % 400 === 0;

export const diasDelMes = (anio, mes) =>
  [31, esBisiesto(anio) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mes - 1];

/** { anio, mes, dia } o null si no es una fecha real (el 29-feb solo existe en años bisiestos). */
export function parsearFecha(texto) {
  if (typeof texto !== 'string') return null;
  const m = RE_FECHA.exec(texto);
  if (!m) return null;
  const anio = Number(m[1]);
  const mes = Number(m[2]);
  const dia = Number(m[3]);
  if (anio < 1900 || mes < 1 || mes > 12 || dia < 1 || dia > diasDelMes(anio, mes)) return null;
  return { anio, mes, dia };
}

export function sumarDias(fecha, dias) {
  const p = parsearFecha(fecha);
  if (!p) throw new RangeError(`Fecha inválida: ${fecha}`);
  return new Date(Date.UTC(p.anio, p.mes - 1, p.dia) + dias * MS_DIA).toISOString().slice(0, 10);
}

/** Días de calendario entre `desde` y `hasta` (positivo si `hasta` es posterior). */
export function diferenciaDias(desde, hasta) {
  const a = parsearFecha(desde);
  const b = parsearFecha(hasta);
  if (!a || !b) throw new RangeError(`Fecha inválida: ${desde} / ${hasta}`);
  return Math.round((Date.UTC(b.anio, b.mes - 1, b.dia) - Date.UTC(a.anio, a.mes - 1, a.dia)) / MS_DIA);
}

/** Edad cumplida en `hoy`. Quien nació un 29-feb cumple años el 1-mar en años no bisiestos. */
export function calcularEdad(fechaNacimiento, hoy) {
  const n = parsearFecha(fechaNacimiento);
  const h = parsearFecha(hoy);
  if (!n || !h) throw new RangeError('Fecha inválida');
  let edad = h.anio - n.anio;
  if (h.mes < n.mes || (h.mes === n.mes && h.dia < n.dia)) edad -= 1;
  return edad;
}

/** Fecha y hora de negocio ({ fecha: 'AAAA-MM-DD', hora: 'HH:MM:SS' }) en la zona indicada. */
export function fechaHoraEnZona(instante = new Date(), zona = 'America/Mexico_City') {
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: zona,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(instante)
      .map((p) => [p.type, p.value]),
  );
  return {
    fecha: `${partes.year}-${partes.month}-${partes.day}`,
    hora: `${partes.hour}:${partes.minute}:${partes.second}`,
  };
}

// ---------------------------------------------------------------------------
// Utilidades de texto y de identificadores
// ---------------------------------------------------------------------------

const limpiarTexto = (v) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '');
const esObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const tieneErrores = (detalle) => Object.keys(detalle).length > 0;
const normalizarClave = (v) => String(v).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

const RE_NOMBRE = /^\p{L}[\p{L} '.-]{1,59}$/u;
const RE_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const RE_ID = /^[A-Za-z0-9_-]{1,30}$/;

export const METODOS_PAGO = ['efectivo', 'tarjeta', 'transferencia'];
export const MAYORIA_DE_EDAD = 18;

const esId = (v) => typeof v === 'string' && RE_ID.test(v);
const centavos = (n) => Math.round(n * 100);

// ---------------------------------------------------------------------------
// Validación de las solicitudes (una función por forma de entrada, sin repetirlas en las rutas)
// ---------------------------------------------------------------------------

/** { socioId } para validar acceso. */
export function validarSolicitudAcceso(entrada) {
  const e = esObjeto(entrada) ? entrada : {};
  if (!esId(e.socioId)) return datosInvalidos({ socioId: 'socioId es obligatorio.' });
  return ok({ socioId: e.socioId });
}

/** { socioId, pagoId? } para activar una membresía. */
export function validarSolicitudActivacion(entrada) {
  const e = esObjeto(entrada) ? entrada : {};
  const detalle = {};
  if (!esId(e.socioId)) detalle.socioId = 'socioId es obligatorio.';
  if (e.pagoId !== undefined && !esId(e.pagoId)) detalle.pagoId = 'pagoId no es válido.';
  if (tieneErrores(detalle)) return datosInvalidos(detalle);
  return ok({ socioId: e.socioId, pagoId: e.pagoId });
}

/** { planId, pagoId? } para renovar una membresía. */
export function validarSolicitudRenovacion(entrada) {
  const e = esObjeto(entrada) ? entrada : {};
  const detalle = {};
  if (!esId(e.planId)) detalle.planId = 'planId es obligatorio.';
  if (e.pagoId !== undefined && !esId(e.pagoId)) detalle.pagoId = 'pagoId no es válido.';
  if (tieneErrores(detalle)) return datosInvalidos(detalle);
  return ok({ planId: e.planId, pagoId: e.pagoId });
}

// ---------------------------------------------------------------------------
// Socios
// ---------------------------------------------------------------------------

/**
 * Valida y normaliza los datos de un socio nuevo.
 * Obligatorios: nombre, apellidos, telefono (10 dígitos), fechaNacimiento (AAAA-MM-DD real, no futura).
 * Opcional: correo. Menores de 18 años requieren cartaResponsiva === true.
 * Duplicado: mismo correo, o mismo nombre + apellidos + fecha de nacimiento (sin acentos ni mayúsculas).
 */
export function validarSocio(entrada, { socios = [], hoy } = {}) {
  const e = esObjeto(entrada) ? entrada : {};
  const detalle = {};

  const nombre = limpiarTexto(e.nombre);
  if (!nombre) detalle.nombre = 'El nombre es obligatorio.';
  else if (!RE_NOMBRE.test(nombre)) detalle.nombre = 'El nombre solo admite letras, espacios, apóstrofo, punto y guion (2 a 60 caracteres).';

  const apellidos = limpiarTexto(e.apellidos);
  if (!apellidos) detalle.apellidos = 'Los apellidos son obligatorios.';
  else if (!RE_NOMBRE.test(apellidos)) detalle.apellidos = 'Los apellidos solo admiten letras, espacios, apóstrofo, punto y guion (2 a 60 caracteres).';

  let telefono = '';
  if (e.telefono === undefined || e.telefono === null || e.telefono === '') {
    detalle.telefono = 'El teléfono es obligatorio.';
  } else {
    telefono = String(e.telefono).replace(/[\s().-]/g, '');
    if (!/^\d{10}$/.test(telefono)) detalle.telefono = 'El teléfono debe tener 10 dígitos.';
  }

  let correo = null;
  if (e.correo !== undefined && e.correo !== null && e.correo !== '') {
    const c = limpiarTexto(e.correo).toLowerCase();
    if (typeof e.correo !== 'string' || c.length > 120 || !RE_CORREO.test(c)) detalle.correo = 'El correo no tiene un formato válido.';
    else correo = c;
  }

  let fechaNacimiento = '';
  let edad = null;
  if (!e.fechaNacimiento) {
    detalle.fechaNacimiento = 'La fecha de nacimiento es obligatoria.';
  } else if (!parsearFecha(e.fechaNacimiento)) {
    detalle.fechaNacimiento = 'La fecha de nacimiento debe ser una fecha real con formato AAAA-MM-DD.';
  } else if (hoy && e.fechaNacimiento > hoy) {
    detalle.fechaNacimiento = 'La fecha de nacimiento no puede ser futura.';
  } else {
    fechaNacimiento = e.fechaNacimiento;
    edad = hoy ? calcularEdad(fechaNacimiento, hoy) : null;
    if (edad !== null && edad > 110) detalle.fechaNacimiento = 'La fecha de nacimiento no es creíble.';
  }

  if (e.cartaResponsiva !== undefined && typeof e.cartaResponsiva !== 'boolean') {
    detalle.cartaResponsiva = 'cartaResponsiva debe ser verdadero o falso.';
  }
  const cartaResponsiva = e.cartaResponsiva === true;
  if (edad !== null && edad < MAYORIA_DE_EDAD && !cartaResponsiva && !detalle.cartaResponsiva) {
    detalle.cartaResponsiva = `Los menores de ${MAYORIA_DE_EDAD} años necesitan la Carta Responsiva firmada antes de registrarse.`;
  }

  if (tieneErrores(detalle)) return datosInvalidos(detalle, 'Los datos del socio no son válidos.');

  const claveIdentidad = normalizarClave(`${nombre}|${apellidos}|${fechaNacimiento}`);
  for (const s of socios) {
    if (correo && s.correo === correo) {
      return fallo('SOCIO_DUPLICADO', 'Ya existe un socio registrado con ese correo.', { correo: `Ya lo usa el socio ${s.id}.` });
    }
    if (normalizarClave(`${s.nombre}|${s.apellidos}|${s.fechaNacimiento}`) === claveIdentidad) {
      return fallo('SOCIO_DUPLICADO', 'Ya existe un socio con el mismo nombre, apellidos y fecha de nacimiento.', {
        nombre: `Coincide con el socio ${s.id}.`,
      });
    }
  }

  return ok({ nombre, apellidos, telefono, correo, fechaNacimiento, cartaResponsiva, estado: 'activo' });
}

/** Búsqueda por id, nombre o apellidos (sin distinguir mayúsculas ni acentos). */
export function filtrarSocios(socios, consulta) {
  const q = normalizarClave(limpiarTexto(consulta));
  if (!q) return socios;
  return socios.filter((s) => normalizarClave(`${s.id} ${s.nombre} ${s.apellidos}`).includes(q));
}

// ---------------------------------------------------------------------------
// Pagos
// ---------------------------------------------------------------------------

/**
 * Valida un pago simulado antes de registrarlo.
 * Orden: forma (400) -> socio (404) -> plan (404) -> plan disponible (409) -> monto = tarifa vigente (409).
 * `membresia` (opcional) solo sirve para marcar el concepto: ALTA o RENOVACION.
 */
export function validarPago(entrada, { socio, plan, membresia } = {}) {
  const e = esObjeto(entrada) ? entrada : {};
  const detalle = {};

  if (!esId(e.socioId)) detalle.socioId = 'socioId es obligatorio.';
  if (!esId(e.planId)) detalle.planId = 'planId es obligatorio.';
  if (!METODOS_PAGO.includes(e.metodo)) detalle.metodo = `El método de pago debe ser: ${METODOS_PAGO.join(', ')}.`;
  if (typeof e.monto !== 'number' || !Number.isFinite(e.monto)) detalle.monto = 'El monto es obligatorio y debe ser numérico.';
  if (tieneErrores(detalle)) return datosInvalidos(detalle, 'Los datos del pago no son válidos.');

  if (!socio) return fallo('SOCIO_NO_EXISTE', `No existe el socio ${e.socioId}.`);
  if (!plan) return fallo('PLAN_NO_EXISTE', `No existe el plan ${e.planId}.`);
  if (!plan.disponible) return fallo('PLAN_NO_DISPONIBLE', `El plan "${plan.nombre}" no está disponible.`);
  if (centavos(e.monto) !== centavos(plan.precio)) {
    return fallo('MONTO_INCORRECTO', 'El monto no coincide con la tarifa vigente del plan.', {
      monto: `Debe ser ${plan.precio.toFixed(2)}; se recibió ${e.monto}.`,
    });
  }

  return ok({
    socioId: socio.id,
    planId: plan.id,
    monto: plan.precio,
    metodo: e.metodo,
    concepto: membresia ? 'RENOVACION' : 'ALTA',
  });
}

/** Pago confirmado y todavía sin aplicar, el más antiguo del socio (y del plan, si se indica). data = pago o null. */
export function seleccionarPagoPendiente(pagos, { socioId, planId } = {}) {
  const candidatos = pagos
    .filter((p) => p.socioId === socioId && p.estado === 'confirmado' && !p.aplicado && (!planId || p.planId === planId))
    .sort((a, b) => `${a.fecha}${a.hora}${a.id}`.localeCompare(`${b.fecha}${b.hora}${b.id}`));
  return ok(candidatos[0] ?? null);
}

/**
 * Un pago solo puede activar o renovar si:
 *  existe y está confirmado; pertenece al socio; corresponde al plan; no se usó antes;
 *  y su monto coincide con la tarifa vigente del plan.
 */
export function verificarPagoAplicable(pago, { socioId, plan }) {
  if (!pago || pago.estado !== 'confirmado') {
    return fallo('PAGO_REQUERIDO', 'No se puede activar una membresía sin pago.');
  }
  if (pago.socioId !== socioId) {
    return fallo('PAGO_NO_PERTENECE_AL_SOCIO', `El pago ${pago.id} pertenece a otro socio.`);
  }
  if (pago.planId !== plan.id) {
    return fallo('PAGO_NO_CORRESPONDE_AL_PLAN', `El pago ${pago.id} es del plan "${pago.planId}", no del plan "${plan.id}".`);
  }
  if (pago.aplicado) {
    return fallo('PAGO_YA_UTILIZADO', `El pago ${pago.id} ya se utilizó en una membresía.`);
  }
  if (centavos(pago.monto) !== centavos(plan.precio)) {
    return fallo('MONTO_INCORRECTO', 'El monto del pago no coincide con la tarifa vigente del plan.', {
      monto: `Debe ser ${plan.precio.toFixed(2)}; el pago ${pago.id} es de ${pago.monto.toFixed(2)}.`,
    });
  }
  return ok(pago);
}

// ---------------------------------------------------------------------------
// Membresías: vigencia, activación y renovación
// ---------------------------------------------------------------------------

/**
 * Vigencia calculada por fechas (inicio y vencimiento INCLUSIVOS):
 *   hoy < inicio  -> no_iniciada | hoy > vencimiento -> vencida | en otro caso -> vigente (incluye "vence hoy").
 * Es independiente del `estado` administrativo guardado (activa, suspendida, cancelada).
 */
export function vigenciaMembresia(membresia, hoy) {
  if (diferenciaDias(hoy, membresia.inicio) > 0) return 'no_iniciada';
  const restantes = diferenciaDias(hoy, membresia.vencimiento);
  return restantes < 0 ? 'vencida' : 'vigente';
}

export const calcularVencimiento = (inicio, duracionDias) => sumarDias(inicio, duracionDias);

/** Membresía con su vigencia y los días que le quedan a la fecha `hoy`. */
export function vistaMembresia(membresia, hoy) {
  return {
    ...membresia,
    vigencia: vigenciaMembresia(membresia, hoy),
    diasRestantes: Math.max(0, diferenciaDias(hoy, membresia.vencimiento)),
  };
}

/** Primera activación: exige que no exista membresía y un pago válido y sin usar. El plan es el del pago. */
export function activarMembresia({ socio, membresia, pago, plan, hoy }) {
  if (membresia) {
    return fallo('MEMBRESIA_EXISTENTE', 'El socio ya tiene una membresía; usa la renovación para extender su vigencia.', {
      membresiaId: membresia.id,
    });
  }
  if (!pago) return fallo('PAGO_REQUERIDO', 'No se puede activar una membresía sin pago.');
  if (!plan) return fallo('PLAN_NO_EXISTE', `No existe el plan ${pago.planId} del pago.`);
  const valido = verificarPagoAplicable(pago, { socioId: socio.id, plan });
  if (!valido.ok) return valido;
  return ok({
    socioId: socio.id,
    planId: plan.id,
    pagoId: pago.id,
    estado: 'activa',
    inicio: hoy,
    vencimiento: calcularVencimiento(hoy, plan.duracionDias),
  });
}

/**
 * Renovación:
 *  - vigente o por iniciar (incluye "vence hoy"): ACUMULADA -> los días se suman al vencimiento actual.
 *  - vencida: DESDE_HOY -> el nuevo periodo empieza hoy y se cuenta desde hoy.
 *  - suspendida o cancelada: no se renueva (409).
 * El plan puede ser distinto al anterior: la nueva duración es la del plan elegido.
 */
export function renovarMembresia({ membresia, pago, plan, hoy }) {
  if (membresia.estado === 'cancelada') return fallo('MEMBRESIA_CANCELADA', 'La membresía está cancelada y no se puede renovar.');
  if (membresia.estado === 'suspendida') return fallo('MEMBRESIA_SUSPENDIDA', 'La membresía está suspendida y no se puede renovar.');
  if (!plan) return fallo('PLAN_NO_EXISTE', 'El plan indicado no existe.');
  if (!pago) return fallo('PAGO_REQUERIDO', `No se puede renovar la membresía sin un pago del plan "${plan.id}".`);
  const valido = verificarPagoAplicable(pago, { socioId: membresia.socioId, plan });
  if (!valido.ok) return valido;

  const acumulada = vigenciaMembresia(membresia, hoy) !== 'vencida';
  const desde = acumulada ? membresia.vencimiento : hoy;
  return ok({
    tipo: acumulada ? 'ACUMULADA' : 'DESDE_HOY',
    planId: plan.id,
    pagoId: pago.id,
    inicio: acumulada ? membresia.inicio : hoy,
    desde,
    vencimientoAnterior: membresia.vencimiento,
    vencimiento: calcularVencimiento(desde, plan.duracionDias),
  });
}

// ---------------------------------------------------------------------------
// Acceso
// ---------------------------------------------------------------------------

// Cada regla recibe { socio, membresia, hoy } y devuelve un MOTIVO de rechazo o null si no objeta.
// Se evalúan en orden y gana la primera que objete. Agregar una regla = agregar una entrada a la lista
// (o pasar otra lista a autorizarAcceso); no hay que tocar las demás.
const regla = (motivo, objeta) => ({ motivo, objeta });

export const REGLAS_ACCESO = [
  regla('SOCIO_NO_EXISTE', ({ socio }) => !socio),
  regla('SOCIO_BLOQUEADO', ({ socio }) => socio.estado === 'bloqueado'),
  // Confirmado por los documentos: los menores de 18 necesitan la Carta Responsiva firmada.
  regla('CARTA_RESPONSIVA_PENDIENTE', ({ socio, hoy }) => calcularEdad(socio.fechaNacimiento, hoy) < MAYORIA_DE_EDAD && !socio.cartaResponsiva),
  regla('SIN_MEMBRESIA', ({ membresia }) => !membresia),
  regla('MEMBRESIA_CANCELADA', ({ membresia }) => membresia.estado === 'cancelada'),
  regla('MEMBRESIA_SUSPENDIDA', ({ membresia }) => membresia.estado === 'suspendida'),
  regla('MEMBRESIA_NO_INICIADA', ({ membresia, hoy }) => vigenciaMembresia(membresia, hoy) === 'no_iniciada'),
  regla('MEMBRESIA_VENCIDA', ({ membresia, hoy }) => vigenciaMembresia(membresia, hoy) === 'vencida'),
];

export const MOTIVOS_RECHAZO = REGLAS_ACCESO.map((r) => r.motivo);

/**
 * Decide si un socio puede entrar. Siempre devuelve ok (la evaluación se hizo bien):
 *   { autorizado: true, venceEl }  o  { autorizado: false, motivo }.
 */
export function autorizarAcceso({ socio, membresia, hoy }, reglas = REGLAS_ACCESO) {
  const rechazo = reglas.find((r) => r.objeta({ socio, membresia, hoy }));
  if (rechazo) return ok({ autorizado: false, motivo: rechazo.motivo });
  return ok({ autorizado: true, venceEl: membresia.vencimiento });
}

/** Registro de bitácora (sin id: lo asigna el almacenamiento) para cualquier intento, autorizado o rechazado. */
export function construirRegistroAcceso({ socioId, membresia, decision, usuario, fecha, hora }) {
  return {
    fecha,
    hora,
    socioId,
    resultado: decision.autorizado ? 'AUTORIZADO' : 'RECHAZADO',
    motivo: decision.autorizado ? null : decision.motivo,
    membresiaId: membresia?.id ?? null,
    usuario,
  };
}

/** Filtros opcionales de la bitácora: socioId, resultado, desde, hasta, limite. */
export function validarFiltrosBitacora(consulta = {}) {
  const detalle = {};
  const filtros = {};
  if (consulta.socioId !== undefined) {
    if (!esId(consulta.socioId)) detalle.socioId = 'socioId no es válido.';
    else filtros.socioId = consulta.socioId;
  }
  if (consulta.resultado !== undefined) {
    if (consulta.resultado !== 'AUTORIZADO' && consulta.resultado !== 'RECHAZADO') detalle.resultado = 'resultado debe ser AUTORIZADO o RECHAZADO.';
    else filtros.resultado = consulta.resultado;
  }
  for (const campo of ['desde', 'hasta']) {
    if (consulta[campo] !== undefined) {
      if (!parsearFecha(consulta[campo])) detalle[campo] = `${campo} debe ser una fecha AAAA-MM-DD.`;
      else filtros[campo] = consulta[campo];
    }
  }
  if (consulta.limite !== undefined) {
    const n = Number(consulta.limite);
    if (!Number.isInteger(n) || n < 1 || n > 500) detalle.limite = 'limite debe ser un entero entre 1 y 500.';
    else filtros.limite = n;
  }
  if (tieneErrores(detalle)) return datosInvalidos(detalle, 'Los filtros no son válidos.');
  return ok(filtros);
}

/** Aplica los filtros y devuelve la bitácora de la más reciente a la más antigua. */
export function filtrarBitacora(accesos, { socioId, resultado, desde, hasta, limite = 100 } = {}) {
  return accesos
    .filter(
      (a) =>
        (socioId === undefined || a.socioId === socioId) &&
        (resultado === undefined || a.resultado === resultado) &&
        (desde === undefined || a.fecha >= desde) &&
        (hasta === undefined || a.fecha <= hasta),
    )
    .sort((a, b) => `${b.fecha}${b.hora}${b.id}`.localeCompare(`${a.fecha}${a.hora}${a.id}`))
    .slice(0, limite);
}
