import express from 'express';
import { estadoHttp } from '../reglasNegocio.js';

// Adaptador HTTP del inicio de sesión. La lógica vive en auth.js.
export function crearRutasAuth({ auth }) {
  const router = express.Router();

  // POST /api/auth/login  { usuario, contrasena } -> { token, expiraEn, usuario }
  router.post('/login', async (req, res) => {
    const { usuario, contrasena } = req.body ?? {};
    const resultado = await auth.login(usuario, contrasena);
    res.status(estadoHttp(resultado)).json(resultado);
  });

  return router;
}
