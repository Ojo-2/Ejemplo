import express from 'express';
import { estadoHttp, ok, validarPago } from '../reglasNegocio.js';

export function crearRutasPagos({ almacen, auth, reloj }) {
  const router = express.Router();

  // POST /api/pagos  { socioId, planId, metodo, monto }
  // Pago simulado: queda confirmado al instante y pendiente de aplicarse a una membresía.
  // Las reglas (socio, plan, tarifa vigente) están en validarPago.
  router.post('/', auth.requierePermiso('pagos:registrar'), async (req, res) => {
    const { fecha, hora } = reloj.ahora();
    const resultado = await almacen.transaccion(async (tx) => {
      const cuerpo = req.body ?? {};
      const socio = typeof cuerpo.socioId === 'string' ? await tx.obtener('socios', cuerpo.socioId) : null;
      const plan = typeof cuerpo.planId === 'string' ? await tx.obtener('planes', cuerpo.planId) : null;
      const membresia = socio ? (await tx.buscar('membresias', { socioId: socio.id }))[0] : null;

      const r = validarPago(cuerpo, { socio, plan, membresia });
      if (!r.ok) return r;
      const pago = await tx.insertar('pagos', {
        ...r.data,
        estado: 'confirmado',
        fecha,
        hora,
        aplicado: false,
        membresiaId: null,
        registradoPor: req.sesion.usuario,
      });
      return ok(pago);
    });
    res.status(estadoHttp(resultado, 201)).json(resultado);
  });

  return router;
}
