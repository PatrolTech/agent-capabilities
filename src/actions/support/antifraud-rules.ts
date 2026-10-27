import { z } from 'zod';
import { segunIdioma, type FixedTextLanguage } from '../../domain/language.js';
import type { CheckpointDetail, CheckpointFraudRules } from '../../gateway/index.js';
import type { BotActionParams } from '../types.js';
import { INTERNO } from './shared.js';

/**
 * Reglas antifraude de un checkpoint (proximidad GPS y modo subterráneo): qué
 * cambios admite, cómo quedan tras aplicarlos y cómo se describen. Sin backend.
 */

/** La que pone el panel al activar la proximidad GPS (checkpoint-wizard). */
const DISTANCIA_POR_DEFECTO_M = 100;

const reglasSchema = z.object({
  gpsProximity: z
    .object({ maxDistanceMeters: z.number(), maxAccuracyMeters: z.number().optional() })
    .optional(),
  undergroundMode: z.object({ enabled: z.boolean() }).optional(),
});

/** Parámetros de `edit_checkpoint_antifraud`: aquí, junto a las reglas, para que `CambiosAntifraude` salga de ellos. */
export const antifraudParams = {
  checkpoint: z.string().trim().min(1).describe('Nombre del checkpoint'),
  ubicacion: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe('Ubicación del checkpoint, si hay varios con ese nombre. OMÍTELO si no hace falta.'),
  proximidad_gps: z
    .boolean()
    .optional()
    .describe(
      'true = activar la proximidad GPS (o ajustarla); false = desactivarla. OMÍTELO si no cambia o si solo das la distancia.'
    ),
  // Aquí se acepta de 10 a 5000 m; la API solo exige > 0.
  distancia_maxima_m: z
    .number()
    .int()
    .min(10)
    .max(5000)
    .optional()
    .describe(
      'Distancia máxima en metros entre el móvil y el punto (10-5000). Si los avisos son por distancia, súbela (p. ej. a 100). OMÍTELA si no cambia.'
    ),
  precision_maxima_m: z
    .number()
    .int()
    .min(1)
    .max(1000)
    .optional()
    .describe(
      'Precisión GPS máxima en metros: con una lectura peor, no se comprueba la distancia (por defecto 50). OMÍTELA salvo que el cliente la pida.'
    ),
  modo_subterraneo: z
    .boolean()
    .optional()
    .describe(
      'true = activar el modo subterráneo (avisa si el móvil tiene cobertura en el punto); false = desactivarlo. OMÍTELO si no cambia.'
    ),
  checkpoint_id: z.string().optional().describe(INTERNO),
  ubicacion_id: z.string().optional().describe(INTERNO),
  reglas_antes: reglasSchema.optional().describe(INTERNO),
  reglas_despues: reglasSchema.optional().describe(INTERNO),
};

/** Los cambios de antifraude que pide el cliente (derivados de los parámetros: no pueden divergir). */
export type CambiosAntifraude = Pick<
  BotActionParams<typeof antifraudParams>,
  'proximidad_gps' | 'distancia_maxima_m' | 'precision_maxima_m' | 'modo_subterraneo'
>;

export const tocaGps = (c: CambiosAntifraude): boolean =>
  c.proximidad_gps === true ||
  c.distancia_maxima_m !== undefined ||
  c.precision_maxima_m !== undefined;

/**
 * Por qué este checkpoint no admite estos cambios desde aquí (null = sí los admite).
 * La misma comprobación al proponer y al confirmar, con el checkpoint del momento:
 * una proximidad GPS escrita en un punto de geocerca o sin posición no se aplicaría.
 */
export function bloqueoAntifraude(
  detalle: CheckpointDetail,
  c: CambiosAntifraude
): 'reglas_desconocidas' | 'geocerca' | 'sin_posicion' | null {
  if (detalle.reglasDesconocidas.length > 0) return 'reglas_desconocidas';
  if (!tocaGps(c)) return null;
  if (detalle.metodo === 'geofence') return 'geocerca';
  if (detalle.latitud === null || detalle.longitud === null) return 'sin_posicion';
  return null;
}

/** Sin una regla = desactivada; el modo subterráneo apagado no se guarda (como hace el panel). */
export function normalizar(r: CheckpointFraudRules): CheckpointFraudRules {
  return {
    ...(r.gpsProximity ? { gpsProximity: r.gpsProximity } : {}),
    ...(r.undergroundMode?.enabled ? { undergroundMode: { enabled: true } } : {}),
  };
}

/**
 * Las reglas actuales con los cambios pedidos. El backend REEMPLAZA `fraudRules`
 * entero: lo que no se toca tiene que volver tal cual estaba.
 */
export function reglasConCambios(
  actuales: CheckpointFraudRules,
  c: CambiosAntifraude
): CheckpointFraudRules {
  const r = normalizar(actuales);
  if (c.proximidad_gps === false) {
    delete r.gpsProximity;
  } else if (tocaGps(c)) {
    const antes = r.gpsProximity;
    const precision = c.precision_maxima_m ?? antes?.maxAccuracyMeters;
    r.gpsProximity = {
      maxDistanceMeters:
        c.distancia_maxima_m ?? antes?.maxDistanceMeters ?? DISTANCIA_POR_DEFECTO_M,
      ...(precision !== undefined ? { maxAccuracyMeters: precision } : {}),
    };
  }
  if (c.modo_subterraneo === true) r.undergroundMode = { enabled: true };
  if (c.modo_subterraneo === false) delete r.undergroundMode;
  return r;
}

export const mismasReglas = (a: CheckpointFraudRules, b: CheckpointFraudRules): boolean =>
  JSON.stringify(normalizar(a)) === JSON.stringify(normalizar(b));

export function textoGps(
  g: CheckpointFraudRules['gpsProximity'],
  idioma: FixedTextLanguage
): string {
  const t = segunIdioma(idioma, {
    es: { off: 'desactivada', max: 'máx.', precision: 'precisión GPS máx.' },
    en: { off: 'off', max: 'max.', precision: 'GPS accuracy max.' },
    fr: { off: 'désactivée', max: 'max.', precision: 'précision GPS max.' },
  });
  if (!g) return t.off;
  return `${t.max} ${g.maxDistanceMeters} m${g.maxAccuracyMeters !== undefined ? ` (${t.precision} ${g.maxAccuracyMeters} m)` : ''}`;
}

export function textoSubterraneo(
  u: CheckpointFraudRules['undergroundMode'],
  idioma: FixedTextLanguage
): string {
  const on = u?.enabled === true;
  return segunIdioma(idioma, {
    es: on ? 'activado' : 'desactivado',
    en: on ? 'on' : 'off',
    fr: on ? 'activé' : 'désactivé',
  });
}
