import express from 'express';
import {
  autorizarAcceso,
  construirRegistroAcceso,
  estadoHttp,
  filtrarBitacora,
  ok,
  validarFiltrosBitacora,
  validarSolicitudAcceso,
} from '../reglasNegocio.js';

export function crearRutasAccesos({ almacen, auth, reloj }) {
  const router = express.Router();

  // POST /api/accesos/validar  { socioId }
  // La decisión es de autorizarAcceso. Todo intento (autorizado o rechazado) queda en la bitácora.
  // Una entrada rechazada por una regla de acceso responde 200 con autorizado:false y el motivo.
  router.post('/validar', auth.requierePermiso('accesos:validar'), async (req, res) => {
    const solicitud = validarSolicitudAcceso(req.body);
    if (!solicitud.ok) return res.status(estadoHttp(solicitud)).json(solicitud);

    const { fecha, hora } = reloj.ahora();
    const { socioId } = solicitud.data;
    const resultado = await almacen.transaccion(async (tx) => {
      const socio = await tx.obtener('socios', socioId);
      const membresia = socio ? ((await tx.buscar('membresias', { socioId }))[0] ?? null) : null;
      const decision = autorizarAcceso({ socio, membresia, hoy: fecha });
      await tx.insertar(
        'accesos',
        construirRegistroAcceso({ socioId, membresia, decision: decision.data, usuario: req.sesion.usuario, fecha, hora }),
      );
      return decision;
    });
    return res.status(estadoHttp(resultado)).json(resultado);
  });

  // GET /api/accesos?socioId=&resultado=&desde=&hasta=&limite=   (bitácora; solo administrador)
  router.get('/', auth.requierePermiso('accesos:bitacora'), async (req, res) => {
    const filtros = validarFiltrosBitacora(req.query);
    if (!filtros.ok) return res.status(estadoHttp(filtros)).json(filtros);
    return res.json(ok(filtrarBitacora(await almacen.lectura.listar('accesos'), filtros.data)));
  });

  return router;
}
