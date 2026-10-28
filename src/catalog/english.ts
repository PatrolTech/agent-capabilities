import type { z } from 'zod';
import { INCIDENT_PRIORITIES } from '../domain/incident-priority.js';
import { INCIDENT_STATUS_LABELS, INCIDENT_STATUS_PARAM } from '../domain/incident-status.js';

/**
 * La cara en inglés de las capacidades para los canales en inglés (el MCP): las capacidades y el
 * bot siguen con sus parámetros y campos en español; el consumidor traduce en su borde con esto.
 *
 * Diccionarios fijos, no i18n. Un parámetro nuevo de una capacidad del canal `mcp` sin
 * nombre o descripción aquí hace fallar `englishInputSchema` (y el test del catálogo); un campo de
 * salida nuevo que no esté aquí ni en la lista de campos en inglés del test hace fallar ese test.
 * Los textos para personas (resúmenes, avisos, motivos) no son nombres: siguen el idioma del usuario.
 */

/** Nombres en inglés de parámetros y campos, los mismos en la entrada y en la salida. */
const NAMES: Readonly<Record<string, string>> = {
  activa: 'active',
  activar: 'enable',
  alMenos: 'atLeast',
  ambito: 'scope',
  asignadaA: 'assignedTo',
  asignadoA: 'assignedTo',
  asignar_a: 'assignTo',
  autor: 'author',
  bateriaPct: 'batteryPct',
  canal: 'channel',
  cargando: 'charging',
  categoria: 'category',
  cerradaEn: 'closedAt',
  checkpointsCreados: 'checkpointsCreated',
  comentario: 'comment',
  conexion: 'connection',
  creadaEn: 'createdAt',
  dentroAhora: 'insideNow',
  descripcion: 'description',
  desde: 'from',
  dias: 'days',
  dias_minimos: 'minDays',
  diasSinEscanear: 'daysWithoutScan',
  direccion: 'address',
  dispositivo: 'device',
  distanciaGpsM: 'gpsDistanceM',
  enlace: 'link',
  enlaceGeneral: 'generalLink',
  enlaces: 'links',
  entradas: 'entries',
  entradasSinSalida: 'entriesWithoutExit',
  escaneados: 'scanned',
  escaneos: 'scans',
  estado: 'status',
  fecha: 'date',
  fin: 'end',
  fotos: 'photos',
  franjas: 'timeWindows',
  gestores: 'managers',
  hasta: 'to',
  hayEscaneos: 'hasScans',
  hechos: 'done',
  historial: 'history',
  hora: 'time',
  horarios: 'schedules',
  identificador: 'identifier',
  idioma: 'language',
  incidencia: 'incident',
  incidencias: 'incidents',
  incluidos: 'included',
  inicio: 'start',
  limite: 'limit',
  mensajeParaReenviar: 'messageToForward',
  metodo: 'method',
  modelo: 'model',
  motivo: 'reason',
  motivosSospecha: 'suspicionReasons',
  nombre: 'name',
  noValidos: 'invalid',
  numero: 'number',
  observador: 'viewer',
  oculta: 'hidden',
  operacion: 'operation',
  orden_estricto: 'strictOrder',
  otrasRondasCercanas: 'otherNearbyRounds',
  pendientes: 'pending',
  periodo: 'period',
  pendientesRevision: 'pendingReview',
  personas: 'people',
  precisionGpsM: 'gpsAccuracyM',
  prioridad: 'priority',
  puesto: 'position',
  que: 'what',
  queHaceCadaRol: 'whatEachRoleDoes',
  quien: 'who',
  repetir_cada_min: 'repeatEveryMin',
  reportadaPor: 'reportedBy',
  resueltaEn: 'resolvedAt',
  ronda: 'round',
  ruta: 'route',
  rutas: 'routes',
  rutasCreadas: 'routesCreated',
  salidas: 'exits',
  siguientePaso: 'nextStep',
  sinEscaneosVisibles: 'noVisibleScans',
  sinSalidaRegistrada: 'withoutRecordedExit',
  sistema: 'os',
  sospechosos: 'suspicious',
  solo_dentro: 'insideOnly',
  solo_no_validos: 'invalidOnly',
  solo_sospechosos: 'suspiciousOnly',
  telefono: 'phone',
  tipo: 'type',
  titulo: 'title',
  totalEscaneos: 'totalScans',
  ubicacion: 'location',
  ubicaciones: 'locations',
  ultimoEscaneo: 'lastScan',
  ultimos: 'latest',
  usadas: 'used',
  usados: 'used',
  uso: 'usage',
  usuarios: 'users',
  validacion: 'validation',
  validos: 'valid',
  vigilante: 'guard',
  vigilantes: 'guards',
  vigilantesConAlgunEscaneo: 'guardsWithScans',
  zona: 'zone',
  zonaHoraria: 'timezone',
};

/** Valores de los parámetros enumerados (el resto de valores no se traduce). */
const VALUES: Readonly<Record<string, string>> = {
  hoy: 'today',
  ayer: 'yesterday',
  ultimos_7_dias: 'last_7_days',
  ultimos_30_dias: 'last_30_days',
  todos: 'all',
  entrada: 'entry',
  salida: 'exit',
  abierto: 'open',
  en_progreso: 'in_progress',
  resuelto: 'resolved',
  cerrado: 'closed',
  descartado: 'dismissed',
  codigo_manual: 'manual_code',
  añadir: 'add',
  quitar: 'remove',
  lun: 'mon',
  mar: 'tue',
  mie: 'wed',
  jue: 'thu',
  vie: 'fri',
  sab: 'sat',
  dom: 'sun',
};

/**
 * Valores de salida que son etiquetas fijas del panel, por campo (con su nombre en español): el
 * modelo los ve con el mismo vocabulario que los parámetros en inglés (`status: 'open'`). Solo
 * esos campos y esas etiquetas: un nombre escrito por un usuario («Alta») nunca se toca.
 */
const OUTPUT_VALUES: Readonly<Partial<Record<string, Readonly<Partial<Record<string, string>>>>>> =
  {
    estado: Object.fromEntries(
      Object.entries(INCIDENT_STATUS_PARAM).map(([param, code]) => [
        INCIDENT_STATUS_LABELS[code].es,
        VALUES[param] ?? param,
      ])
    ),
    prioridad: Object.fromEntries(Object.values(INCIDENT_PRIORITIES).map(({ es, en }) => [es, en])),
  };

const OMIT_IF_UNCHANGED = 'Omit it if it does not change.';
const DATE_FROM = 'Start date of the range, YYYY-MM-DD (never words like "yesterday").';
const DATE_TO = 'End date of the range (inclusive), YYYY-MM-DD.';
const PERIOD =
  'Relative period. Use it when the user says "today", "yesterday", "last week", "last month" or similar.';
const ROUTE_FILTER = 'Route name. Omit it (do not send it empty) if the user has not given one.';
const DAYS = 'Days on which the time window STARTS.';
const TIME_FROM = 'Start time, HH:mm in the local time of the account.';
const TIME_TO =
  'End time, HH:mm local. If it is earlier than `from`, it ends the next day (20:00-05:00).';

/**
 * Descripción en inglés de cada parámetro que ve el modelo, por id del catálogo y parámetro
 * (los anidados, con su ruta: `franjas.dias`).
 */
const DESCRIPTIONS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  'rounds.get_checkpoints': { ruta: ROUTE_FILTER },
  'rounds.get_round': {
    ruta: ROUTE_FILTER,
    fecha:
      'Day of the round in the calendar of the account, YYYY-MM-DD. Omit it for the latest round.',
    hora: 'Approximate start time, HH:mm in the local time of the account. Only together with `date`.',
  },
  'routes.get_schedules': { ruta: ROUTE_FILTER },
  'scans.list_recent': {
    periodo: PERIOD,
    desde: DATE_FROM,
    hasta: DATE_TO,
    vigilante: 'Guard name: only their scans. Omit it unless asked.',
    checkpoint: 'Checkpoint name: only its scans. Omit it unless asked.',
    ubicacion: 'Location name: only its scans. Omit it unless asked.',
    solo_sospechosos: 'true: only the scans flagged as suspicious.',
    solo_no_validos: 'true: only the rejected (invalid) scans.',
  },
  'patrollers.get_stats': {
    vigilante: 'Name of the guard (never empty: if you do not know it, ask).',
  },
  'patrollers.get_ranking': {
    periodo: PERIOD,
    desde: DATE_FROM,
    hasta: DATE_TO,
  },
  'scans.count_by_patroller': {
    periodo: `${PERIOD} Omit it (and from/to) for the last 7 days.`,
    desde: DATE_FROM,
    hasta: DATE_TO,
  },
  'checkpoints.list_unreviewed': {
    ubicacion: 'Only the checkpoints of this location. Omit it for all.',
    dias_minimos: 'Only the ones with at least this many days without a scan. Omit it to see all.',
  },
  'patrollers.get_app_links': {
    vigilante:
      'Name of the guard who will receive it: returns their link and `messageToForward`, the message to forward to them. Omit it to list the links of every guard.',
    idioma: "Language of `messageToForward`: 'es', 'en' or 'fr' (any other language: 'en').",
  },
  'incidents.list': { estado: 'Only the incidents with this status. Omit it to see all.' },
  'incidents.get': {
    incidencia:
      'Title (or part of it), `id` or number in the incident list (without status filter).',
  },
  'access.list_logs': {
    periodo: 'Period. Omit it (and from/to) for the last 24 hours.',
    desde: DATE_FROM,
    hasta: DATE_TO,
    ubicacion: 'Location name. Omit it for all.',
    zona: 'Access zone, written as in the dashboard. Omit it for all.',
    tipo: 'Only entries or only exits. Omit it for both.',
    solo_dentro:
      'true: only who is inside now (entries without an exit in the last 24 h; older ones come apart, as exits not recorded).',
  },
  'checkpoints.propose_create': {
    nombre:
      'Checkpoint name: short, describing the place, in normal case, e.g. "Main entrance". No generic prefixes such as "Checkpoint 1" and no numbering; if the user gives it that way, propose the clean version (they see it in the summary). If they insist on their format, keep it.',
    ubicacion: 'Location where to create it. Ask for it only if there are several.',
    metodo:
      'qr (default: printed and stuck on the spot) or manual_code (the guard types the code; when it cannot be printed).',
  },
  'alerts.propose_set_preference': {
    tipo: 'Alert type: pending_route, missed_route, upcoming_deadline, patroller_inactive (guard inactive), suspicious_scan, role_assignment, incident_created, incident_status_changed, incident_assigned or incident_comment.',
    canal: 'Channel: email, push or whatsapp.',
    activar: 'true = start receiving it on that channel; false = stop receiving it.',
  },
  'routes.propose_create': {
    nombre: 'Route name.',
    ubicacion: 'Location of the route. Ask for it only if there are several.',
    checkpoints: 'Names of the checkpoints of the route, in the order they are walked.',
    orden_estricto: 'true = they must be scanned in that order. Default: no.',
    franjas: 'Schedules of the route, in the local time of the account.',
    'franjas.dias': DAYS,
    'franjas.desde': TIME_FROM,
    'franjas.hasta': TIME_TO,
    'franjas.repetir_cada_min':
      'ONLY for one round every X minutes inside the window (60 = one round per hour): it is split into schedules of that length. Without it, the window is ONE schedule for a single round.',
  },
  'routes.propose_add_time_window': {
    ruta: 'Route name.',
    dias: DAYS,
    desde: TIME_FROM,
    hasta: TIME_TO,
  },
  'routes.propose_set_active': {
    ruta: 'Route name.',
    activa: 'true = activate it; false = deactivate it.',
  },
  'routes.propose_change_checkpoint': {
    ruta: 'Route name.',
    checkpoint: 'Checkpoint name.',
    operacion: 'add (at the end of the route) or remove.',
  },
  'incidents.propose_update': {
    incidencia:
      'Title of the incident (or part of it), or its `id` as listed by the incident list.',
    estado: `New status: open, in_progress (it must be assigned), resolved (needs a comment), closed (FINAL) or dismissed (needs a comment; FINAL). ${OMIT_IF_UNCHANGED}`,
    comentario: 'Comment to add. Required for resolved and dismissed (the reason).',
    asignar_a:
      'Dashboard user to assign it to (name or email), or "me" for the user themself. Omit it if it is not reassigned.',
  },
  'patrollers.propose_rename': {
    vigilante: 'Current name of the guard.',
    nombre: `New name. ${OMIT_IF_UNCHANGED}`,
    telefono: `New phone number of the guard. ${OMIT_IF_UNCHANGED}`,
  },
  'checkpoints.propose_edit': {
    checkpoint: 'Current name of the checkpoint.',
    ubicacion: 'Location of the checkpoint, if several share that name. Omit it otherwise.',
    nombre: `New name. ${OMIT_IF_UNCHANGED}`,
    descripcion: `New description. ${OMIT_IF_UNCHANGED}`,
  },
  'locations.propose_edit': {
    ubicacion: 'Current name of the location. Ask for it only if there are several.',
    nombre: `New name. ${OMIT_IF_UNCHANGED}`,
    direccion: `New address. ${OMIT_IF_UNCHANGED} It cannot be left empty.`,
  },
};

const english = (name: string): string => NAMES[name] ?? name;
const englishValue = (value: string): string => VALUES[value] ?? value;
const spanishValue = (value: string, values: readonly string[]): string =>
  values.find((v) => englishValue(v) === value) ?? value;

type AnySchema = z.ZodType & { def: Record<string, unknown>; clone(def: unknown): z.ZodType };

/** El mismo esquema con los valores enumerados y las claves de objeto en inglés (conserva sus checks). */
function translateSchema(
  schema: z.ZodType,
  describe: (path: string) => string,
  path: string
): z.ZodType {
  const s = schema as AnySchema;
  const { def } = s;
  switch (def.type) {
    case 'optional':
    case 'nullable':
    case 'default':
      return s.clone({
        ...def,
        innerType: translateSchema(def.innerType as z.ZodType, describe, path),
      });
    case 'array':
      return s.clone({
        ...def,
        element: translateSchema(def.element as z.ZodType, () => '', path),
      });
    case 'enum': {
      const values = Object.values(def.entries as Record<string, string>).map(englishValue);
      return s.clone({ ...def, entries: Object.fromEntries(values.map((v) => [v, v])) });
    }
    case 'object':
      return s.clone({
        ...def,
        shape: translateShape(def.shape as z.ZodRawShape, describe, `${path}.`),
      });
    default:
      return schema;
  }
}

function translateShape(
  shape: z.ZodRawShape,
  describe: (path: string) => string,
  prefix = ''
): z.ZodRawShape {
  return Object.fromEntries(
    Object.entries(shape).map(([name, schema]) => {
      const translated = translateSchema(schema as z.ZodType, describe, `${prefix}${name}`);
      return [english(name), translated.describe(describe(`${prefix}${name}`))];
    })
  );
}

/**
 * Los parámetros de una capacidad con nombres, valores y descripciones en inglés, para que los vea
 * el modelo. Lanza si a alguno le falta la descripción en inglés (un parámetro nuevo sin traducir).
 */
export function englishInputSchema(id: string, shape: z.ZodRawShape): z.ZodRawShape {
  const descriptions = DESCRIPTIONS[id] ?? {};
  return translateShape(shape, (path) => {
    const description = descriptions[path];
    if (!description) throw new Error(`No English description for the param ${id}.${path}`);
    return description;
  });
}

/** Un valor en inglés de vuelta a lo que espera la capacidad, guiado por su esquema en español. */
function toSpanish(schema: z.ZodType, value: unknown): unknown {
  const { def } = schema as AnySchema;
  switch (def.type) {
    case 'optional':
    case 'nullable':
    case 'default':
      return toSpanish(def.innerType as z.ZodType, value);
    case 'array':
      return Array.isArray(value)
        ? value.map((v) => toSpanish(def.element as z.ZodType, v))
        : value;
    case 'enum':
      return typeof value === 'string'
        ? spanishValue(value, Object.values(def.entries as Record<string, string>))
        : value;
    case 'object':
      return value && typeof value === 'object'
        ? argsFromEnglish(def.shape as z.ZodRawShape, value as Record<string, unknown>)
        : value;
    default:
      return value;
  }
}

/**
 * Los argumentos que mandó el modelo (en inglés) como los espera la capacidad (`shape`, sus
 * parámetros en español). Lo que no es un parámetro de la capacidad se descarta.
 */
export function argsFromEnglish(
  shape: z.ZodRawShape,
  args: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, schema] of Object.entries(shape)) {
    const value = args[english(name)];
    if (value !== undefined) out[name] = toSpanish(schema as z.ZodType, value);
  }
  return out;
}

/** El valor de un campo de salida: traducido solo si es una etiqueta fija de ese campo. */
function englishOutputValue(key: string, value: unknown): unknown {
  if (typeof value === 'string') return OUTPUT_VALUES[key]?.[value] ?? value;
  return englishFields(value);
}

/**
 * Los datos que devuelve una capacidad con sus claves en inglés. Los valores no se tocan, salvo las
 * etiquetas fijas de estado y prioridad de las incidencias (`OUTPUT_VALUES`).
 */
export function englishFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(englishFields);
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(
      Object.entries(value).map(([key, v]) => [english(key), englishOutputValue(key, v)])
    );
  }
  return value;
}
