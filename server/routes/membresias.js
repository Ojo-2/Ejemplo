import express from 'express';
import {
  activarMembresia,
  estadoHttp,
  fallo,
  ok,
  renovarMembresia,
  seleccionarPagoPendiente,
  validarSolicitudActivacion,
  validarSolicitudRenovacion,
  vistaMembresia,
} from '../reglasNegocio.js';

// Pago a usar: el indicado por `pagoId` (404 si no existe) o, si no se indica, el pendiente más antiguo del socio.
// Que el pago sea válido (socio, plan, uso único, tarifa) lo decide reglasNegocio.js.
async function resolverPago(tx, { socioId, pagoId, planId }) {
  if (pagoId === undefined) {
    return seleccionarPagoPendiente(await tx.buscar('pagos', { socioId }), { socioId, planId });
  }
  const pago = await tx.obtener('pagos', pagoId);
  return pago ? ok(pago) : fallo('PAGO_NO_EXISTE', `No existe el pago ${pagoId}.`);
}

export function crearRutasMembresias({ almacen, auth, reloj }) {
  const router = express.Router();

  // POST /api/membresias/activar  { socioId, pagoId? }
  router.post('/activar', auth.requierePermiso('membresias:activar'), async (req, res) => {
    const solicitud = validarSolicitudActivacion(req.body);
    if (!solicitud.ok) return res.status(estadoHttp(solicitud)).json(solicitud);

    const { fecha: hoy } = reloj.ahora();
    const resultado = await almacen.transaccion(async (tx) => {
      const socio = await tx.obtener('socios', solicitud.data.socioId);
      if (!socio) return fallo('SOCIO_NO_EXISTE', `No existe el socio ${solicitud.data.socioId}.`);

      const membresia = (await tx.buscar('membresias', { socioId: socio.id }))[0] ?? null;
      const seleccion = await resolverPago(tx, { socioId: socio.id, pagoId: solicitud.data.pagoId });
      if (!seleccion.ok) return seleccion;
      const pago = seleccion.data;
      const plan = pago ? await tx.obtener('planes', pago.planId) : null;

      const r = activarMembresia({ socio, membresia, pago, plan, hoy });
      if (!r.ok) return r;

      // Dos escrituras que deben ocurrir juntas: si una falla, la transacción revierte ambas.
      const creada = await tx.insertar('membresias', {
        ...r.data,
        historial: [{ tipo: 'ACTIVACION', pagoId: pago.id, planId: plan.id, desde: r.data.inicio, hasta: r.data.vencimiento, fecha: hoy }],
      });
      await tx.actualizar('pagos', pago.id, { aplicado: true, membresiaId: creada.id });
      return ok(vistaMembresia(creada, hoy));
    });
    return res.status(estadoHttp(resultado, 201)).json(resultado);
  });

  // POST /api/membresias/:id/renovar  { planId, pagoId? }
  router.post('/:id/renovar', auth.requierePermiso('membresias:renovar'), async (req, res) => {
    const solicitud = validarSolicitudRenovacion(req.body);
    if (!solicitud.ok) return res.status(estadoHttp(solicitud)).json(solicitud);

    const { fecha: hoy } = reloj.ahora();
    const resultado = await almacen.transaccion(async (tx) => {
      const membresia = await tx.obtener('membresias', req.params.id);
      if (!membresia) return fallo('MEMBRESIA_NO_EXISTE', `No existe la membresía ${req.params.id}.`);

      const { planId, pagoId } = solicitud.data;
      const plan = await tx.obtener('planes', planId);
      const seleccion = await resolverPago(tx, { socioId: membresia.socioId, pagoId, planId });
      if (!seleccion.ok) return seleccion;

      const r = renovarMembresia({ membresia, pago: seleccion.data, plan, hoy });
      if (!r.ok) return r;

      const actualizada = await tx.actualizar('membresias', membresia.id, {
        planId: r.data.planId,
        pagoId: r.data.pagoId,
        inicio: r.data.inicio,
        vencimiento: r.data.vencimiento,
        historial: [
          ...membresia.historial,
          { tipo: `RENOVACION_${r.data.tipo}`, pagoId: r.data.pagoId, planId: r.data.planId, desde: r.data.desde, hasta: r.data.vencimiento, fecha: hoy },
        ],
      });
      await tx.actualizar('pagos', r.data.pagoId, { aplicado: true, membresiaId: membresia.id });
      return ok({ ...vistaMembresia(actualizada, hoy), renovacion: { tipo: r.data.tipo, vencimientoAnterior: r.data.vencimientoAnterior } });
    });
    return res.status(estadoHttp(resultado)).json(resultado);
  });

  // GET /api/membresias/:socioId   (fechas, vigencia y días restantes)
  router.get('/:socioId', auth.requierePermiso('membresias:consultar'), async (req, res) => {
    const { lectura } = almacen;
    const socio = await lectura.obtener('socios', req.params.socioId);
    let resultado;
    if (!socio) {
      resultado = fallo('SOCIO_NO_EXISTE', `No existe el socio ${req.params.socioId}.`);
    } else {
      const membresia = (await lectura.buscar('membresias', { socioId: socio.id }))[0];
      resultado = membresia
        ? ok({ ...vistaMembresia(membresia, reloj.hoy()), plan: await lectura.obtener('planes', membresia.planId) })
        : fallo('MEMBRESIA_NO_EXISTE', `El socio ${socio.id} todavía no tiene membresía.`);
    }
    res.status(estadoHttp(resultado)).json(resultado);
  });

  return router;
}
