import { z } from 'zod';
import { segunIdioma, type FixedTextLanguage } from '../../domain/language.js';
import {
  DIAS,
  describirDias,
  expandirFranja,
  horariosParaBackend,
  type Franja,
} from '../../domain/route-schedule.js';
import { utcOffsetMinutes } from '../../domain/timezone.js';
import type { NewTimeWindow } from '../../gateway/index.js';

/** Parámetros y textos de horarios que comparten crear ruta y añadir o borrar un horario. */

export const HORA = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Usa HH:mm (24 h)');
export const DIAS_PARAM = z
  .array(z.enum(DIAS))
  .min(1)
  .describe('Días en los que EMPIEZA la franja: lun, mar, mie, jue, vie, sab, dom');
export const DESDE = HORA.describe('Hora de inicio, HH:mm en la hora LOCAL del cliente');
export const HASTA = HORA.describe(
  'Hora de fin, HH:mm local. Si es menor que `desde`, acaba al día siguiente (20:00-05:00)'
);
export const RUTA = z.string().trim().min(1).describe('Nombre de la ruta');
export const HORAS_LOCALES =
  'Las horas son SIEMPRE las del cliente, tal como las dice: el bot las convierte a UTC.';

/** «lun, mar de 20:00 a 05:00 (acaba al día siguiente), una ronda cada 60 min: 9 horarios». */
export function describirFranja(f: Franja, idioma: FixedTextLanguage): string {
  const t = segunIdioma(idioma, {
    es: {
      de: 'de',
      a: 'a',
      cruza: ' (acaba al día siguiente)',
      cada: (min: number, n: number) => `, una ronda cada ${min} min: ${n} horarios`,
    },
    en: {
      de: 'from',
      a: 'to',
      cruza: ' (ends the next day)',
      cada: (min: number, n: number) => `, one round every ${min} min: ${n} time slots`,
    },
    fr: {
      de: 'de',
      a: 'à',
      cruza: ' (se termine le lendemain)',
      cada: (min: number, n: number) => `, une ronde toutes les ${min} min : ${n} créneaux`,
    },
  });
  const base = `${describirDias(f.dias, idioma)} ${t.de} ${f.desde} ${t.a} ${f.hasta}${f.hasta < f.desde ? t.cruza : ''}`;
  if (!f.repetir_cada_min) return base;
  const r = expandirFranja(f);
  return `${base}${t.cada(f.repetir_cada_min, 'error' in r ? 0 : r.length)}`;
}

/** Los horarios UTC para el backend con la zona en que se configuraron. Lanza si ya no valen (los validó `preparar`). */
export function horariosUtc(franjas: readonly Franja[], tz: string): NewTimeWindow[] {
  const r = horariosParaBackend(franjas, utcOffsetMinutes(tz));
  if ('error' in r) throw new Error(`horarios no válidos al ejecutar: ${r.error}`);
  return r.map((h) => ({ ...h, timezone: tz }));
}

export const franjaSchema = z.object({
  dias: DIAS_PARAM,
  desde: DESDE,
  hasta: HASTA,
  repetir_cada_min: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      'SOLO si quiere una ronda cada X minutos dentro de la franja (60 = una ronda por hora): se parte en horarios de esa duración. ' +
        'Sin él, la franja es UN horario para una sola ronda.'
    ),
});
