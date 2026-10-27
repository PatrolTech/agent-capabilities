import { z } from 'zod';

/** Esquemas de parámetros que comparten varias capacidades (mismas descripciones que el bot). */

// Regex, no solo la descripción: una fecha en palabras lanzaba y se llevaba el turno.
const ymd = () => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Usa exactamente YYYY-MM-DD');

export const scansParamSchema = {
  periodo: z
    .enum(['hoy', 'ayer', 'ultimos_7_dias', 'ultimos_30_dias', 'todos'])
    .optional()
    .describe(
      'Periodo relativo a consultar. Úsalo cuando el usuario diga "hoy", "ayer", "última semana", "último mes" o similar.'
    ),
  desde: ymd()
    .optional()
    .describe(
      'Fecha de inicio del rango, formato YYYY-MM-DD (nunca palabras como "ayer"). Úsalo si el usuario da una fecha concreta.'
    ),
  hasta: ymd()
    .optional()
    .describe(
      'Fecha de fin del rango (inclusive), formato YYYY-MM-DD (nunca palabras como "hoy").'
    ),
};

export const scansFiltrosSchema = {
  ...scansParamSchema,
  vigilante: z
    .string()
    .min(1)
    .optional()
    .describe('Nombre del vigilante: solo sus escaneos. OMÍTELO si no se pide.'),
  checkpoint: z
    .string()
    .min(1)
    .optional()
    .describe('Nombre del checkpoint: solo sus escaneos. OMÍTELO si no se pide.'),
  ubicacion: z
    .string()
    .min(1)
    .optional()
    .describe('Nombre de la ubicación: solo sus escaneos. OMÍTELO si no se pide.'),
  solo_sospechosos: z
    .boolean()
    .optional()
    .describe('true: solo los escaneos marcados como sospechosos.'),
  solo_no_validos: z
    .boolean()
    .optional()
    .describe('true: solo los escaneos rechazados (no válidos).'),
};

export const fechaSchema = (que: string) =>
  ymd().describe(`${que}, formato YYYY-MM-DD en el calendario del cliente`);

export const rutaParamSchema = {
  ruta: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Nombre de la ruta. Opcional: OMÍTELO (no lo mandes vacío) si el usuario no lo ha indicado.'
    ),
};

export const accesosParamSchema = {
  periodo: z
    .enum(['hoy', 'ayer', 'ultimos_7_dias', 'ultimos_30_dias'])
    .optional()
    .describe('Periodo a consultar. OMÍTELO (y desde/hasta) para las últimas 24 horas.'),
  desde: scansParamSchema.desde,
  hasta: scansParamSchema.hasta,
  ubicacion: z.string().min(1).optional().describe('Nombre de la ubicación. OMÍTELO para todas.'),
  zona: z
    .string()
    .min(1)
    .optional()
    .describe('Zona de acceso, escrita como en el panel. OMÍTELO para todas.'),
  tipo: z
    .enum(['entrada', 'salida'])
    .optional()
    .describe('Solo entradas o solo salidas. OMÍTELO para las dos.'),
  solo_dentro: z
    .boolean()
    .optional()
    .describe(
      'true: solo quién está dentro ahora (entradas sin salida de las últimas 24 h; las más antiguas vienen aparte, como salidas sin registrar).'
    ),
};
