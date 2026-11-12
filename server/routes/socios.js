import express from 'express';
import { estadoHttp, fallo, filtrarSocios, ok, validarSocio, vistaMembresia } from '../reglasNegocio.js';

export function crearRutasSocios({ almacen, auth, reloj }) {
  const router = express.Router();
  const { lectura } = almacen;

  const conMembresia = (socio, membresia, hoy) => ({ ...socio, membresia: membresia ? vistaMembresia(membresia, hoy) : null });
  const membresiaDe = async (leer, socioId) => (await leer.buscar('membresias', { socioId }))[0] ?? null;

  // GET /api/socios?q=texto   (busca por id, nombre o apellidos)
  router.get('/', auth.requierePermiso('socios:consultar'), async (req, res) => {
    const hoy = reloj.hoy();
    const socios = filtrarSocios(await lectura.listar('socios'), typeof req.query.q === 'string' ? req.query.q : '');
    const membresias = await lectura.listar('membresias');
    res.json(ok(socios.map((s) => conMembresia(s, membresias.find((m) => m.socioId === s.id), hoy))));
  });

  // POST /api/socios
  router.post('/', auth.requierePermiso('socios:crear'), async (req, res) => {
    const hoy = reloj.hoy();
    const resultado = await almacen.transaccion(async (tx) => {
      const r = validarSocio(req.body, { socios: await tx.listar('socios'), hoy });
      if (!r.ok) return r;
      const socio = await tx.insertar('socios', { ...r.data, fechaRegistro: hoy, registradoPor: req.sesion.usuario });
      return ok(conMembresia(socio, null, hoy));
    });
    res.status(estadoHttp(resultado, 201)).json(resultado);
  });

  // GET /api/socios/:id
  router.get('/:id', auth.requierePermiso('socios:consultar'), async (req, res) => {
    const socio = await lectura.obtener('socios', req.params.id);
    const resultado = socio
      ? ok(conMembresia(socio, await membresiaDe(lectura, socio.id), reloj.hoy()))
      : fallo('SOCIO_NO_EXISTE', `No existe el socio ${req.params.id}.`);
    res.status(estadoHttp(resultado)).json(resultado);
  });

  return router;
}
