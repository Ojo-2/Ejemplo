// Arranque del servidor: Express, CORS, conexión de dependencias, montaje de rutas y manejo global de errores.
// `crearApp` RECIBE almacenamiento y reloj: así las pruebas (o una BD real) se inyectan sin tocar las rutas.

import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import cors from 'cors';
import express from 'express';
import { crearAlmacenamientoArchivo } from './almacenamiento.js';
import { crearAutenticacion } from './auth.js';
import { estadoHttp, fallo, fechaHoraEnZona, parsearFecha } from './reglasNegocio.js';
import { crearRutasAccesos } from './routes/accesos.js';
import { crearRutasAuth } from './routes/auth.js';
import { crearRutasMembresias } from './routes/membresias.js';
import { crearRutasPagos } from './routes/pagos.js';
import { crearRutasPlanes } from './routes/planes.js';
import { crearRutasSocios } from './routes/socios.js';

const DIR = path.dirname(fileURLToPath(import.meta.url));

/** Reloj de negocio: { ahora() -> {fecha, hora}, hoy() -> fecha }. Con `fechaSimulada` el día queda fijo. */
export function crearReloj({ zona = 'America/Mexico_City', fechaSimulada } = {}) {
  if (fechaSimulada && !parsearFecha(fechaSimulada)) throw new Error(`FECHA_SIMULADA inválida: ${fechaSimulada}`);
  const ahora = () => {
    const real = fechaHoraEnZona(new Date(), zona);
    return fechaSimulada ? { fecha: fechaSimulada, hora: real.hora } : real;
  };
  return { ahora, hoy: () => ahora().fecha };
}

export function crearApp({ almacen, reloj, secreto, origenesPermitidos = [], ahoraMs }) {
  const app = express();
  app.disable('x-powered-by');

  const buscarUsuario = async (usuario) => (await almacen.lectura.buscar('usuarios', { usuario }))[0] ?? null;
  const auth = crearAutenticacion({ buscarUsuario, secreto, ahoraMs });

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(cors({ origin: origenesPermitidos, methods: ['GET', 'POST', 'OPTIONS'] }));
  app.use(express.json({ limit: '50kb' }));

  app.use('/api/auth', crearRutasAuth({ auth }));
  app.use('/api/socios', crearRutasSocios({ almacen, auth, reloj }));
  app.use('/api/planes', crearRutasPlanes({ lectura: almacen.lectura, auth }));
  app.use('/api/pagos', crearRutasPagos({ almacen, auth, reloj }));
  app.use('/api/membresias', crearRutasMembresias({ almacen, auth, reloj }));
  app.use('/api/accesos', crearRutasAccesos({ almacen, auth, reloj }));

  app.use((req, res) => {
    const r = fallo('RUTA_NO_ENCONTRADA', `No existe ${req.method} ${req.path}.`);
    res.status(estadoHttp(r)).json(r);
  });

  // Manejo global de errores: nunca se filtran detalles internos al cliente.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    let r;
    if (err?.type === 'entity.parse.failed') r = fallo('JSON_INVALIDO', 'El cuerpo de la petición no es un JSON válido.');
    else if (err?.type === 'entity.too.large') r = fallo('CUERPO_DEMASIADO_GRANDE', 'El cuerpo de la petición es demasiado grande.');
    else {
      console.error('[error no controlado]', err);
      r = fallo('ERROR_INTERNO', 'Ocurrió un error interno. Intenta de nuevo.');
    }
    res.status(estadoHttp(r)).json(r);
  });

  return app;
}

// ---------------------------------------------------------------------------
// Arranque (solo cuando se ejecuta este archivo directamente: npm run server)
// ---------------------------------------------------------------------------
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const puerto = Number(process.env.PORT ?? 3001);
  const origenes = (process.env.ORIGENES_PERMITIDOS ?? 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  let secreto = process.env.SECRETO_TOKEN;
  if (!secreto) {
    secreto = crypto.randomBytes(32).toString('hex');
    console.warn('SECRETO_TOKEN no definido: se generó uno temporal (las sesiones se pierden al reiniciar).');
  }

  // Único lugar que elige las implementaciones concretas: archivo JSON y reloj real.
  const almacen = crearAlmacenamientoArchivo({
    ruta: process.env.ARCHIVO_DATOS ?? path.join(DIR, 'data', 'datos.json'),
    rutaSemilla: path.join(DIR, 'data', 'datosDemo.json'),
  });
  const reloj = crearReloj({ zona: process.env.ZONA_HORARIA ?? 'America/Mexico_City', fechaSimulada: process.env.FECHA_SIMULADA });

  crearApp({ almacen, reloj, secreto, origenesPermitidos: origenes }).listen(puerto, () => {
    console.log(`SACG API en http://localhost:${puerto}  |  fecha de negocio: ${reloj.hoy()}${process.env.FECHA_SIMULADA ? ' (simulada)' : ''}`);
    console.log(`Datos: ${almacen.ruta}`);
  });
}
