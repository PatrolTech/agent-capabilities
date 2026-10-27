/**
 * Horarios (franjas) de una ruta. El backend SOLO guarda y compara horas UTC
 * (`HH:MM` + días ISO 1=lun..7=dom); convertir desde la hora local del cliente es
 * cosa de quien envía (`AddTimeWindowBody` en el contrato de la API).
 *
 * Mismo criterio que el panel:
 * se desplazan las dos horas con el desfase de la zona y los días se mueven según
 * lo que le pase a la hora de INICIO (la franja «pertenece» al día en que empieza).
 * Solapes con la regla del backend: semana
 * circular de minutos, intervalos semiabiertos, una franja que acaba antes de
 * empezar cruza la medianoche.
 */

import type { FixedTextLanguage } from './language.js';

export const DIAS = ['lun', 'mar', 'mie', 'jue', 'vie', 'sab', 'dom'] as const;
export type Dia = (typeof DIAS)[number];
const DIAS_TEXTO = {
  es: ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'],
  en: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  fr: ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'],
} as const satisfies Record<FixedTextLanguage, readonly string[]>;

/** Tope del panel por ruta (PT dashboard: recurrence.ts `MAX_WINDOWS_PER_ROUTE`): una semana de franjas de una hora. */
export const MAX_HORARIOS_POR_RUTA = 168;
/** Intervalo mínimo al repetir una franja (el mismo que el generador del panel). */
export const MIN_REPETICION_MIN = 5;

const DAY = 1440;
const WEEK = 7 * DAY;

/** Un horario tal como lo entiende el backend (o su equivalente local): horas `HH:MM` y días ISO. */
export interface Horario {
  startTime: string;
  endTime: string;
  days: number[];
}

/** Lo que dice el cliente: días en los que EMPIEZA, desde/hasta en SU hora y, opcional, «una ronda cada N minutos». */
export interface Franja {
  dias: readonly Dia[];
  desde: string;
  hasta: string;
  repetir_cada_min?: number;
}

const toMin = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
const toHHMM = (min: number): string => {
  const m = ((min % DAY) + DAY) % DAY;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
/** 1..7 desplazado `n` días, dando la vuelta a la semana (dom+1 = lun). */
const shiftDay = (d: number, n: number): number => ((((d - 1 + n) % 7) + 7) % 7) + 1;
const sortDays = (days: number[]): number[] => [...new Set(days)].sort((a, b) => a - b);

/** `HH:MM:SS` (como lo devuelve el backend) → `HH:MM`. */
export const normalizeTime = (t: string): string => t.slice(0, 5);

/**
 * Los horarios LOCALES de una franja. Sin repetición es uno solo; con
 * `repetir_cada_min` se trocea en horarios consecutivos de esa duración (el
 * último, recortado a `hasta`), y los que empiezan pasada la medianoche caen en
 * el día siguiente: «lun a vie de 20:00 a 05:00 cada hora» da 20-21 … 23-00 de
 * lun a vie y 00-01 … 04-05 de mar a sáb.
 */
export function expandirFranja(f: Franja): Horario[] | { error: string } {
  const desde = toMin(f.desde);
  const hasta = toMin(f.hasta);
  if (desde === hasta)
    return {
      error: `La franja ${f.desde}-${f.hasta} empieza y acaba a la misma hora: pregunta al usuario la hora de fin.`,
    };
  const days = sortDays(f.dias.map((d) => DIAS.indexOf(d) + 1));
  if (!f.repetir_cada_min) return [{ startTime: f.desde, endTime: f.hasta, days }];
  if (f.repetir_cada_min < MIN_REPETICION_MIN)
    return { error: `No se puede repetir cada menos de ${MIN_REPETICION_MIN} minutos.` };

  const total = hasta > desde ? hasta - desde : hasta + DAY - desde;
  const horarios: Horario[] = [];
  for (let offset = 0; offset < total; offset += f.repetir_cada_min) {
    const start = desde + offset;
    const end = desde + Math.min(offset + f.repetir_cada_min, total);
    const shift = Math.floor(start / DAY);
    horarios.push({
      startTime: toHHMM(start),
      endTime: toHHMM(end),
      days: sortDays(days.map((d) => shiftDay(d, shift))),
    });
  }
  return horarios;
}

/** Desplaza un horario `delta` minutos; los días se mueven con la hora de inicio. */
function desplazar(h: Horario, delta: number): Horario {
  const start = toMin(h.startTime) + delta;
  const shift = start < 0 ? -1 : start >= DAY ? 1 : 0;
  return {
    startTime: toHHMM(start),
    endTime: toHHMM(toMin(h.endTime) + delta),
    days: sortDays(h.days.map((d) => shiftDay(d, shift))),
  };
}

/** Hora local → UTC. `offsetMin` es el desfase de la zona (Madrid en verano: +120; Bogotá: -300). */
export const horarioAUtc = (h: Horario, offsetMin: number): Horario => desplazar(h, -offsetMin);
/** UTC → hora local (para enseñárselo al cliente). */
export const horarioALocal = (h: Horario, offsetMin: number): Horario => desplazar(h, offsetMin);

/** Intervalos semiabiertos del horario en la semana circular (el que cruza el domingo se parte en dos). */
function intervalos(h: Horario): [number, number][] {
  const start = toMin(h.startTime);
  const end = toMin(h.endTime);
  // Que acabe antes de empezar = cruza la medianoche; igual = un minuto (lo que hace el backend).
  const dur = end > start ? end - start : end < start ? end + DAY - start : 1;
  return h.days.flatMap((d): [number, number][] => {
    const a = (d - 1) * DAY + start;
    return a + dur <= WEEK
      ? [[a, a + dur]]
      : [
          [a, WEEK],
          [0, a + dur - WEEK],
        ];
  });
}

/** La primera pareja de horarios que comparten algún minuto de la semana, o null. */
export function buscarSolape(horarios: readonly Horario[]): [number, number] | null {
  const iv = horarios.map(intervalos);
  for (let i = 0; i < iv.length; i++) {
    for (let j = i + 1; j < iv.length; j++) {
      if (iv[i].some(([a1, b1]) => iv[j].some(([a2, b2]) => a1 < b2 && a2 < b1))) return [i, j];
    }
  }
  return null;
}

/** «lun, mar, mié 20:00-21:00» (o en inglés). */
export function describirHorario(h: Horario, idioma: FixedTextLanguage = 'es'): string {
  return `${h.days.map((d) => DIAS_TEXTO[idioma][d - 1]).join(', ')} ${h.startTime}-${h.endTime}`;
}

/** Días de una franja tal como los dijo el cliente, en su idioma. */
export const describirDias = (dias: readonly Dia[], idioma: FixedTextLanguage = 'es'): string =>
  sortDays(dias.map((d) => DIAS.indexOf(d) + 1))
    .map((d) => DIAS_TEXTO[idioma][d - 1])
    .join(', ');

/**
 * Los horarios en UTC listos para el backend a partir de las franjas locales:
 * expande repeticiones, convierte y comprueba solapes (con los que ya tiene la
 * ruta, si se pasan) y el tope de 168. Los errores van en palabras para el modelo.
 */
export function horariosParaBackend(
  franjas: readonly Franja[],
  offsetMin: number,
  existentesUtc: readonly Horario[] = []
): Horario[] | { error: string } {
  const locales: Horario[] = [];
  for (const f of franjas) {
    const r = expandirFranja(f);
    if ('error' in r) return r;
    locales.push(...r);
  }
  const total = existentesUtc.length + locales.length;
  if (total > MAX_HORARIOS_POR_RUTA) {
    return {
      error: `Serían ${total} horarios y una ruta admite como máximo ${MAX_HORARIOS_POR_RUTA}: propón franjas más largas o menos repeticiones.`,
    };
  }
  const utc = locales.map((h) => horarioAUtc(h, offsetMin));
  const todos = [...existentesUtc, ...utc];
  const solape = buscarSolape(todos);
  if (solape) {
    const txt = (i: number): string => describirHorario(horarioALocal(todos[i], offsetMin));
    const cual = (i: number): string =>
      i < existentesUtc.length ? 'el horario que ya tiene la ruta' : 'el horario';
    return {
      error:
        `${cual(solape[0])} «${txt(solape[0])}» se solapa con ${cual(solape[1])} «${txt(solape[1])}» (hora del cliente). ` +
        'Dos horarios de una ruta no pueden compartir ningún minuto: pregunta al usuario cómo quiere ajustarlos.',
    };
  }
  return utc;
}

/** Un horario de la ruta visto por el cliente: su id, en hora local y en texto. */
export interface HorarioLocal {
  id: string;
  local: Horario;
  texto: string;
}

/**
 * Los horarios de la ruta (UTC, del backend) en hora local, ordenados por
 * primer día y hora: es la numeración que ve el cliente («1. lun 20:00-21:00»)
 * y con la que luego dice cuál borrar.
 */
export function listarHorarios(
  ventanas: readonly (Horario & { id: string })[],
  offsetMin: number
): HorarioLocal[] {
  return ventanas
    .map((v) => {
      const local = horarioALocal(v, offsetMin);
      return { id: v.id, local, texto: describirHorario(local) };
    })
    .sort(
      (a, b) =>
        (a.local.days[0] ?? 0) - (b.local.days[0] ?? 0) ||
        a.local.startTime.localeCompare(b.local.startTime)
    );
}

const DIA_EN_TEXTO: Record<string, number> = {
  lun: 1,
  mar: 2,
  mie: 3,
  mié: 3,
  jue: 4,
  vie: 5,
  sab: 6,
  sáb: 6,
  dom: 7,
};

/**
 * Cuál de los horarios dice el cliente: su número en la lista o una descripción
 * («lun 20:00-21:00», «el de las 20:00 a 21:00 del martes»). Casa por horas y,
 * si nombra días, se queda con los que los incluyen. Ninguno o varios → error
 * con la lista numerada para que pregunte.
 */
export function elegirHorario(
  horarios: readonly HorarioLocal[],
  entrada: string
): { item: HorarioLocal } | { error: string } {
  const numerada = horarios.map((h, i) => `${i + 1}. ${h.texto}`).join('; ');
  const pregunta = {
    error: `No sé cuál de los horarios es «${entrada}». Pregunta al usuario cuál (hora local): ${numerada}.`,
  };
  const texto = entrada.trim().toLowerCase();
  if (/^\d+$/.test(texto)) {
    const indice = Number(texto) - 1;
    const h = indice >= 0 ? horarios[indice] : undefined;
    return h ? { item: h } : pregunta;
  }
  const horas = [...texto.matchAll(/(\d{1,2})[:.h](\d{2})/g)].map(
    ([, h, m]) => `${h.padStart(2, '0')}:${m}`
  );
  const dias = [...texto.matchAll(/\b(lun|mar|mi[eé]|jue|vie|s[aá]b|dom)/g)].map(
    ([d]) => DIA_EN_TEXTO[d]
  );
  const candidatos = horarios.filter(
    (h) =>
      (horas.length === 0 || h.local.startTime === horas[0]) &&
      (horas.length < 2 || h.local.endTime === horas[1]) &&
      dias.every((d) => h.local.days.includes(d))
  );
  return candidatos.length === 1 && (horas.length > 0 || dias.length > 0)
    ? { item: candidatos[0] }
    : pregunta;
}
