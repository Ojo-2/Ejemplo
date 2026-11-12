import express from 'express';
import { ok } from '../reglasNegocio.js';

// Solo necesita LEER planes, así que recibe únicamente la lectura del contrato (no escritura ni transacciones).
// Los planes, precios y duraciones salen de los datos persistidos; no hay ninguno escrito aquí.
export function crearRutasPlanes({ lectura, auth }) {
  const router = express.Router();

  // GET /api/planes
  router.get('/', auth.requierePermiso('planes:consultar'), async (req, res) => {
    res.json(ok(await lectura.listar('planes')));
  });

  return router;
}
