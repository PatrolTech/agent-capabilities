import type { CapabilityMeta, Channel } from './types.js';

const OWNER = 'producto';
const VERIFIED_AT = '2026-10-22';
const ALL_CHANNELS: Channel[] = ['bot', 'mcp'];
// Solo en el canal `bot`: lo destructivo, lo sensible, lo de facturación y dar acceso a otras
// personas (invitar, dar de alta vigilantes). La API se lo niega además a cualquier agente MCP.
const BOT_ONLY: Channel[] = ['bot'];

interface EntryInput {
  id: string;
  capability: string;
  title: { es: string; en: string };
  summary: { es: string; en: string };
  returns?: { en: string };
  operationIds: string[];
  /** Por defecto, bot y MCP. */
  channels?: Channel[];
  destructive?: boolean;
  /** Por defecto, `organization`. */
  scope?: CapabilityMeta['scope'];
}

function entry(kind: 'read' | 'action', input: EntryInput): CapabilityMeta {
  const channels = [...(input.channels ?? ALL_CHANNELS)];
  return {
    id: input.id,
    capability: input.capability,
    kind,
    channels,
    visibility: channels.includes('mcp') ? 'public' : 'internal',
    status: 'ga',
    readOnly: kind === 'read',
    destructive: input.destructive ?? false,
    scope: input.scope ?? 'organization',
    title: input.title,
    summary: input.summary,
    ...(input.returns ? { returns: input.returns } : {}),
    operationIds: input.operationIds,
    owner: OWNER,
    verifiedAt: VERIFIED_AT,
  };
}

const read = (input: EntryInput): CapabilityMeta => entry('read', input);
const action = (input: EntryInput): CapabilityMeta => entry('action', input);

/** Las 25 lecturas, con el nombre que tienen en el bot. */
export const READ_ENTRIES: readonly CapabilityMeta[] = [
  read({
    id: 'rounds.get_status',
    capability: 'consultar_estado_rondas',
    title: { es: 'Estado de las rondas', en: 'Rounds status' },
    summary: {
      es: 'Úsala cuando quieras saber cuántas rondas hay en curso, completadas o incompletas.',
      en: 'Use when you want to know how many rounds are in progress, completed or incomplete.',
    },
    returns: {
      en: 'Returns the number of rounds by status (`open` = in progress, `completed`, `incomplete` = incomplete or expired) over the last `windowDays` days.',
    },
    operationIds: ['getOrganizationSupportSummary'],
  }),
  read({
    id: 'rounds.list_by_route',
    capability: 'consultar_detalles_rondas',
    title: { es: 'Detalle de rondas por ruta', en: 'Rounds detail by route' },
    summary: {
      es: 'Úsala cuando quieras ver las últimas rondas de cada ruta y cómo terminaron.',
      en: 'Use when you want to see the latest rounds of each route and how they ended.',
    },
    returns: {
      en: 'Returns each route with its recent rounds (status, guard, checkpoints done of total, times in UTC). A route with `error` could not be read: do not say it has no rounds. With `truncated: true` the data is capped: do not state totals or absences.',
    },
    operationIds: ['listRoutes', 'getRouteRounds'],
  }),
  read({
    id: 'rounds.get_checkpoints',
    capability: 'consultar_checkpoints_ronda',
    title: { es: 'Checkpoints de la última ronda', en: 'Checkpoints of the latest round' },
    summary: {
      es: 'Úsala cuando quieras saber qué checkpoints se escanearon y cuáles faltaron en la última ronda de una ruta.',
      en: 'Use when you want to know which checkpoints were scanned and which were missed in the latest round of a route.',
    },
    returns: {
      en: 'Returns the latest round of a route: the checkpoints scanned (with time, UTC) and the ones missing. Without `route` and several active routes it returns the routes to choose from.',
    },
    operationIds: ['listRoutes', 'getRouteRounds', 'getRouteRoundCheckpoints'],
  }),
  read({
    id: 'rounds.get_round',
    capability: 'consultar_ronda',
    title: { es: 'Detalle de una ronda', en: 'Round detail' },
    summary: {
      es: 'Úsala cuando quieras el detalle de una ronda concreta de una ruta, escaneo a escaneo.',
      en: 'Use when you want the detail of a specific round of a route, scan by scan.',
    },
    returns: {
      en: 'Returns one round: status, guard, start and end, checkpoints done (with time) and pending; all times are UTC. Without `date` it is the latest round; other rounds of that day come in `otherNearbyRounds`.',
    },
    operationIds: ['listRoutes', 'getRouteRounds', 'getRouteRoundCheckpoints'],
  }),
  read({
    id: 'routes.get_schedules',
    capability: 'consultar_horarios_ruta',
    title: { es: 'Horarios de una ruta', en: 'Route schedules' },
    summary: {
      es: 'Úsala cuando quieras saber a qué horas y qué días se hace una ruta.',
      en: 'Use when you want to know at what times and on which days a route is run.',
    },
    returns: {
      en: 'Returns the numbered schedules of a route in the local time of the account (days on which each one starts and its time window; an end before the start crosses midnight) and whether the route is active.',
    },
    operationIds: ['listRoutes', 'getRouteWithDetails'],
  }),
  read({
    id: 'checkpoints.list',
    capability: 'obtener_checkpoints',
    title: { es: 'Lista de checkpoints', en: 'Checkpoint list' },
    summary: {
      es: 'Úsala cuando necesites saber qué checkpoints existen, en qué ubicación y con qué identificador.',
      en: 'Use when you need to know which checkpoints exist, in which location and with which identifier.',
    },
    returns: {
      en: 'Returns every checkpoint with its `id` (what the tools on specific checkpoints take, such as the QR sheet), its location and `identifier` (the 8-character code typed as manual code in the app). With `truncated: true` the list is capped: do not state totals or absences.',
    },
    operationIds: ['listLocations', 'listCheckpoints'],
  }),
  read({
    id: 'checkpoints.list_unreviewed',
    capability: 'consultar_checkpoints_sin_revisar',
    title: { es: 'Checkpoints sin revisar', en: 'Unreviewed checkpoints' },
    summary: {
      es: 'Úsala cuando quieras ver qué checkpoints llevan más tiempo sin escanearse.',
      en: 'Use when you want to see which checkpoints have gone the longest without being scanned.',
    },
    returns: {
      en: 'Returns checkpoints from never scanned to longest without a scan, with `lastScan` (UTC) and `daysWithoutScan`. `atLeast: true` means the last scan is older than what could be read (say "more than N days"); `noVisibleScans: true` means no scan of it is visible (never scanned, or older than the data retention period).',
    },
    operationIds: ['listLocations', 'listCheckpoints', 'listScans'],
  }),
  read({
    id: 'scans.list_recent',
    capability: 'consultar_ultimos_scans',
    title: { es: 'Últimos escaneos', en: 'Latest scans' },
    summary: {
      es: 'Úsala cuando quieras ver los escaneos más recientes, con su vigilante, checkpoint y hora.',
      en: 'Use when you want to see the most recent scans, with their guard, checkpoint and time.',
    },
    returns: {
      en: 'Returns scans with checkpoint, guard, time (UTC), `validation` (valid, pending review or rejected, with the reason) and `suspicionReasons` (empty when not suspicious): valid and suspicious are independent. Explain them only from those two fields. `device` and GPS distance come only when known. Items older than the data retention period come with their details hidden. With `truncated: true` the data is capped.',
    },
    operationIds: ['listScans', 'listPatrollers', 'listLocations', 'listCheckpoints'],
  }),
  read({
    id: 'patrollers.list_activity',
    capability: 'consultar_actividad_vigilantes',
    title: { es: 'Actividad de los vigilantes', en: 'Guard activity' },
    summary: {
      es: 'Úsala cuando quieras saber qué vigilantes hay y cuándo fue su último escaneo.',
      en: 'Use when you want to know which guards exist and when their last scan was.',
    },
    returns: {
      en: 'Returns each guard with their status and latest activity (timestamps in UTC). With `truncated: true` the list is capped. To compare guards with each other, use the guard ranking instead of building one from this list.',
    },
    operationIds: ['listPatrollers'],
  }),
  read({
    id: 'patrollers.get_stats',
    capability: 'consultar_stats_vigilante',
    title: { es: 'Estadísticas de un vigilante', en: 'Guard statistics' },
    summary: {
      es: 'Úsala cuando quieras las estadísticas de un vigilante concreto.',
      en: 'Use when you want the statistics of one specific guard.',
    },
    returns: {
      en: 'Returns the totals of one guard over their whole history: `totalScans`, `roundsCompleted` out of `totalRounds`, `completionRate` (percent of the checkpoints of their rounds that were scanned), `avgTimeBetweenScans` (seconds; null without data) and, when known, `incidentsReported` and `incidentsOpen`. `retentionCutoff` (UTC; null when unlimited): activity before it still counts in the totals, but its details are no longer shown. If the name matches several guards or none, it fails with the names to choose from.',
    },
    operationIds: ['listPatrollers', 'getPatrollerStats'],
  }),
  read({
    id: 'patrollers.get_ranking',
    capability: 'consultar_ranking_vigilantes',
    title: { es: 'Ranking de vigilantes', en: 'Guard ranking' },
    summary: {
      es: 'Úsala cuando quieras comparar a los vigilantes por rondas completadas y escaneos en un periodo, en vez de montar tú la comparación.',
      en: 'Use when you want to compare guards by rounds completed and scans over a period, instead of building the comparison yourself.',
    },
    returns: {
      en: 'Returns the guards ordered by their activity in the period (rounds completed, completion rate, scans), each with `totalScans`, `roundsCompleted`, `completionRate` (percent) and `avgTimeBetweenScans` (seconds; null without data), plus a team `summary` and the most scanned checkpoints (`topCheckpoints`). Dates are calendar days in the time zone of the account; without a period it covers everything the data retention allows. `retentionCutoff` (UTC; null when unlimited): the period never starts before it, so older activity is not counted. With `truncated: true` the list is capped. It is activity data, not an assessment of the people (it does not see shifts, absences or assigned tasks): present it with its period and do not draw conclusions from it on your own about the performance or employment of anyone.',
    },
    operationIds: ['getPatrollerRanking'],
  }),
  read({
    id: 'scans.count_by_patroller',
    capability: 'consultar_escaneos_por_vigilante',
    title: { es: 'Escaneos por vigilante', en: 'Scans per guard' },
    summary: {
      es: 'Úsala cuando quieras cuántos escaneos ha hecho cada vigilante en un periodo.',
      en: 'Use when you want how many scans each guard made over a period.',
    },
    returns: {
      en: 'Returns how many scans each guard made in the period (default: the last 7 days; dates are calendar days in the time zone of the account) and how many of them were `valid`, `suspicious`, `invalid` (rejected) and `pendingReview`, ordered by total (`position`), including guards without scans. Valid and suspicious are independent: a scan can be both. Scans older than the data retention period come without their guard and are counted together under "(sin vigilante)". With `truncated: true` only the most recent scans were counted: the counts are partial. Activity counts, not an assessment of the people.',
    },
    operationIds: ['listScans', 'listPatrollers'],
  }),
  read({
    id: 'patrollers.get_app_links',
    capability: 'enlaces_app_vigilantes',
    title: { es: 'Enlaces de la app de vigilantes', en: 'Guard app links' },
    summary: {
      es: 'Úsala cuando quieras el enlace para que cada vigilante entre en la app.',
      en: 'Use when you want the link each guard uses to open the app.',
    },
    returns: {
      en: 'Returns the personal app link of each guard (it signs in as that guard without a password: share each one only with its guard) and the general link of the organization (it asks which guard signs in; give it for a guard not created yet). With `guard`, only theirs plus `messageToForward`: a ready message with their name, their link and how to install the app, to give as is.',
    },
    operationIds: ['listPatrollers'],
  }),
  read({
    id: 'incidents.list',
    capability: 'consultar_incidencias',
    title: { es: 'Lista de incidencias', en: 'Incident list' },
    summary: {
      es: 'Úsala cuando quieras ver las incidencias abiertas o recientes, con su estado y prioridad.',
      en: 'Use when you want to see open or recent incidents, with their status and priority.',
    },
    returns: {
      en: 'Returns incidents from newest to oldest with their position in the list (`number`), `id`, title, `status` (open, in_progress, resolved, closed or dismissed), `priority` (low, medium, high or critical), assignee and date (UTC). Incidents older than the data retention period come without their title. To refer to one later, use its title or `id`.',
    },
    operationIds: ['listIncidents'],
  }),
  read({
    id: 'incidents.get',
    capability: 'consultar_incidencia',
    title: { es: 'Detalle de una incidencia', en: 'Incident detail' },
    summary: {
      es: 'Úsala cuando quieras el detalle de una incidencia: descripción, comentarios y quién la lleva.',
      en: 'Use when you want an incident in detail: description, comments and who is handling it.',
    },
    returns: {
      en: 'Returns one incident: description, status, priority, category, reporter, assignee, linked checkpoints, history of comments and status changes (author and UTC date) and the number of photos and videos (they can only be seen in the dashboard). One older than the data retention period comes with `hidden: true` and no details.',
    },
    operationIds: ['listIncidents', 'getIncidentDetail'],
  }),
  read({
    id: 'access.list_logs',
    capability: 'consultar_accesos',
    title: { es: 'Accesos registrados', en: 'Access logs' },
    summary: {
      es: 'Úsala cuando quieras saber quién ha entrado o está dentro en el control de accesos.',
      en: 'Use when you want to know who has entered or is currently inside, from access control.',
    },
    returns: {
      en: 'Returns the entry and exit totals and the 20 most recent records (local time of the account, type, person, zone and location); with `insideOnly: true`, who entered and has not left. Never repeat the identity document of a visitor.',
    },
    operationIds: ['listLocations', 'listAccessLogs', 'getActiveEntries'],
  }),
  read({
    id: 'users.list_roles',
    capability: 'consultar_usuarios_y_roles',
    title: { es: 'Usuarios del panel y sus roles', en: 'Dashboard users and roles' },
    summary: {
      es: 'Úsala cuando quieras saber quién tiene acceso al panel y con qué rol.',
      en: 'Use when you want to know who has access to the dashboard and with which role.',
    },
    returns: {
      en: 'Returns the dashboard users with their role (Admin, Editor or Viewer) and scope (whole organization or one location), and what each role can change. Only an organization Admin can read it.',
    },
    operationIds: ['getOrganizationUsers', 'listLocations'],
  }),
  read({
    id: 'license.get_usage',
    capability: 'consultar_uso_plan',
    title: { es: 'Uso y límites de la cuenta', en: 'Account usage and limits' },
    summary: {
      es: 'Úsala cuando quieras saber cuántos checkpoints, ubicaciones y gestores se usan frente a los límites de la cuenta.',
      en: 'Use when you want to know how many checkpoints, locations and managers are used against the account limits.',
    },
    returns: {
      en: 'Returns checkpoints used and included, locations and managers used against their limit; a null limit means no cap.',
    },
    operationIds: ['getLicenseInfo'],
  }),
  read({
    id: 'license.get_purchase_link',
    capability: 'enlace_contratar_plan',
    channels: BOT_ONLY,
    title: { es: 'Enlace para contratar un plan', en: 'Plan purchase link' },
    summary: {
      es: 'Úsala cuando el cliente quiera contratar un plan y necesite el enlace de pago.',
      en: 'Use when the customer wants to buy a plan and needs the payment link.',
    },
    operationIds: [
      'getLicenseInfo',
      'getPaymentPrices',
      'createCheckoutSession',
      'createCustomerPortalSession',
    ],
  }),
  read({
    id: 'license.get_manage_link',
    capability: 'enlace_gestionar_suscripcion',
    channels: BOT_ONLY,
    title: { es: 'Enlace para gestionar la suscripción', en: 'Subscription management link' },
    summary: {
      es: 'Úsala cuando el cliente quiera cambiar su suscripción, su tarjeta o sus facturas.',
      en: 'Use when the customer wants to change their subscription, card or invoices.',
    },
    operationIds: ['getLicenseInfo', 'createCustomerPortalSession'],
  }),
  read({
    id: 'account.get_summary',
    capability: 'consultar_resumen_cuenta',
    title: { es: 'Resumen de la cuenta', en: 'Account summary' },
    summary: {
      es: 'Úsala cuando quieras una visión general de la cuenta: rondas, vigilantes e incidencias.',
      en: 'Use when you want an overview of the account: rounds, guards and incidents.',
    },
    returns: {
      en: 'Returns the rounds of the last 7 days by status, the number of guards by status (active, inactive, in alert), the total of checkpoints and the suspicious scans detected.',
    },
    operationIds: ['getOrganizationSupportSummary'],
  }),
  read({
    id: 'account.get_onboarding',
    capability: 'consultar_puesta_en_marcha',
    title: { es: 'Puesta en marcha de la cuenta', en: 'Account setup progress' },
    summary: {
      es: 'Úsala cuando quieras saber qué falta para tener la cuenta funcionando y cuál es el siguiente paso.',
      en: 'Use when you want to know what is missing to get the account running and what the next step is.',
    },
    returns: {
      en: 'Returns the setup checklist (checkpoints, guards, guards with a scan, scans, routes) and `nextStep`, the recommended next step.',
    },
    operationIds: ['getOrganizationSupportSummary', 'listPatrollers', 'listRoutes', 'listScans'],
  }),
  read({
    id: 'checkpoints.send_qr',
    capability: 'enviar_qr_checkpoint',
    title: { es: 'QR de un checkpoint', en: 'Checkpoint QR code' },
    summary: {
      es: 'Úsala cuando necesites el código QR de un checkpoint para imprimirlo o colocarlo.',
      en: 'Use when you need the QR code of a checkpoint to print or place it.',
    },
    returns: {
      en: 'Returns the QR image of a checkpoint (or its manual code) with its `identifier`.',
    },
    operationIds: ['listLocations', 'listCheckpoints'],
  }),
  read({
    id: 'scans.export_excel',
    capability: 'enviar_excel_escaneos',
    title: { es: 'Excel de escaneos', en: 'Scans spreadsheet' },
    summary: {
      es: 'Úsala cuando quieras descargar los escaneos de un periodo en una hoja de cálculo.',
      en: 'Use when you want to download the scans of a period as a spreadsheet.',
    },
    returns: {
      en: 'Returns a spreadsheet file with the scans of the period (at most 31 days).',
    },
    operationIds: ['listScans', 'listPatrollers', 'listLocations', 'listCheckpoints'],
  }),
  read({
    id: 'access.export_excel',
    capability: 'enviar_excel_accesos',
    title: { es: 'Excel de accesos', en: 'Access spreadsheet' },
    summary: {
      es: 'Úsala cuando quieras descargar los accesos de un periodo en una hoja de cálculo.',
      en: 'Use when you want to download the access logs of a period as a spreadsheet.',
    },
    returns: {
      en: 'Returns a spreadsheet file with the access records of the period (at most 31 days).',
    },
    operationIds: ['listLocations', 'listAccessLogs'],
  }),
];

/** Las 19 acciones de escritura, con el nombre de `BOT_ACTIONS`. */
export const ACTION_ENTRIES: readonly CapabilityMeta[] = [
  action({
    id: 'checkpoints.propose_create',
    capability: 'create_checkpoint',
    title: { es: 'Proponer crear un checkpoint', en: 'Propose creating a checkpoint' },
    summary: {
      es: 'Úsala cuando quieras añadir un checkpoint nuevo a una ubicación.',
      en: 'Use when you want to add a new checkpoint to a location.',
    },
    operationIds: ['listLocations', 'listCheckpoints', 'getLicenseInfo', 'createCheckpoint'],
  }),
  action({
    id: 'patrollers.propose_create',
    capability: 'create_patroller',
    channels: BOT_ONLY,
    title: { es: 'Proponer crear un vigilante', en: 'Propose creating a guard' },
    summary: {
      es: 'Úsala cuando quieras dar de alta un vigilante nuevo.',
      en: 'Use when you want to add a new guard.',
    },
    operationIds: ['createPatroller', 'getPatrollerByIdentifier'],
  }),
  action({
    id: 'alerts.propose_set_preference',
    capability: 'set_alert_preference',
    title: { es: 'Proponer cambiar una alerta', en: 'Propose changing an alert' },
    summary: {
      es: 'Úsala cuando quieras activar o desactivar un aviso que recibe el usuario.',
      en: 'Use when you want to turn on or off a notice the user receives.',
    },
    // Las preferencias son del usuario, no de una organización.
    scope: 'user',
    operationIds: ['updateUserPreferences'],
  }),
  action({
    id: 'routes.propose_create',
    capability: 'create_route',
    title: { es: 'Proponer crear una ruta', en: 'Propose creating a route' },
    summary: {
      es: 'Úsala cuando quieras crear una ruta con sus checkpoints y horarios.',
      en: 'Use when you want to create a route with its checkpoints and schedules.',
    },
    operationIds: [
      'listLocations',
      'listCheckpoints',
      'listRoutes',
      'getRouteWithDetails',
      'createRouteComplete',
    ],
  }),
  action({
    id: 'routes.propose_add_time_window',
    capability: 'add_time_window',
    title: { es: 'Proponer añadir un horario a una ruta', en: 'Propose adding a route schedule' },
    summary: {
      es: 'Úsala cuando quieras añadir un horario a una ruta.',
      en: 'Use when you want to add a schedule to a route.',
    },
    operationIds: ['listRoutes', 'getRouteWithDetails', 'addTimeWindowToRoute'],
  }),
  action({
    id: 'routes.propose_delete_time_window',
    capability: 'delete_time_window',
    channels: BOT_ONLY,
    destructive: true,
    title: {
      es: 'Proponer borrar un horario de una ruta',
      en: 'Propose deleting a route schedule',
    },
    summary: {
      es: 'Úsala cuando quieras quitar un horario de una ruta.',
      en: 'Use when you want to remove a schedule from a route.',
    },
    operationIds: ['listRoutes', 'getRouteWithDetails', 'removeTimeWindowFromRoute'],
  }),
  action({
    id: 'routes.propose_set_active',
    capability: 'set_route_active',
    title: {
      es: 'Proponer activar o pausar una ruta',
      en: 'Propose activating or pausing a route',
    },
    summary: {
      es: 'Úsala cuando quieras activar o pausar una ruta.',
      en: 'Use when you want to activate or pause a route.',
    },
    operationIds: ['listRoutes', 'getRouteWithDetails', 'toggleRouteActive'],
  }),
  action({
    id: 'routes.propose_change_checkpoint',
    capability: 'route_checkpoint',
    title: {
      es: 'Proponer añadir o quitar un checkpoint de una ruta',
      en: 'Propose adding or removing a route checkpoint',
    },
    summary: {
      es: 'Úsala cuando quieras añadir o quitar un checkpoint de una ruta.',
      en: 'Use when you want to add or remove a checkpoint on a route.',
    },
    operationIds: [
      'listRoutes',
      'listLocations',
      'listCheckpoints',
      'getRouteWithDetails',
      'addCheckpointToRoute',
      'removeCheckpointFromRoute',
    ],
  }),
  action({
    id: 'incidents.propose_update',
    capability: 'incident_update',
    title: { es: 'Proponer actualizar una incidencia', en: 'Propose updating an incident' },
    summary: {
      es: 'Úsala cuando quieras cambiar el estado, asignar o comentar una incidencia.',
      en: 'Use when you want to change the status of, assign or comment on an incident.',
    },
    operationIds: [
      'listIncidents',
      'getOrganizationUsers',
      'updateIncidentStatus',
      'assignIncident',
      'addIncidentComment',
    ],
  }),
  action({
    id: 'patrollers.propose_rename',
    capability: 'rename_patroller',
    title: { es: 'Proponer editar un vigilante', en: 'Propose editing a guard' },
    summary: {
      es: 'Úsala cuando quieras cambiar el nombre o el teléfono de un vigilante.',
      en: 'Use when you want to change the name or phone of a guard.',
    },
    operationIds: ['listPatrollers', 'updatePatroller'],
  }),
  action({
    id: 'checkpoints.propose_edit',
    capability: 'edit_checkpoint',
    title: { es: 'Proponer editar un checkpoint', en: 'Propose editing a checkpoint' },
    summary: {
      es: 'Úsala cuando quieras cambiar el nombre o la descripción de un checkpoint.',
      en: 'Use when you want to change the name or description of a checkpoint.',
    },
    operationIds: ['listLocations', 'listCheckpoints', 'updateCheckpoint'],
  }),
  action({
    id: 'checkpoints.propose_archive',
    capability: 'archive_checkpoint',
    channels: BOT_ONLY,
    destructive: true,
    title: { es: 'Proponer archivar un checkpoint', en: 'Propose archiving a checkpoint' },
    summary: {
      es: 'Úsala cuando quieras archivar o recuperar un checkpoint.',
      en: 'Use when you want to archive or restore a checkpoint.',
    },
    operationIds: [
      'listLocations',
      'listCheckpoints',
      'getLicenseInfo',
      'listRoutes',
      'getRouteWithDetails',
      'archiveCheckpoint',
      'unarchiveCheckpoint',
    ],
  }),
  action({
    id: 'checkpoints.propose_edit_antifraud',
    capability: 'edit_checkpoint_antifraud',
    channels: BOT_ONLY,
    destructive: true,
    title: { es: 'Proponer cambiar el antifraude', en: 'Propose changing anti-fraud rules' },
    summary: {
      es: 'Úsala cuando quieras cambiar las reglas antifraude de un checkpoint.',
      en: 'Use when you want to change the anti-fraud rules of a checkpoint.',
    },
    operationIds: ['listLocations', 'listCheckpoints', 'updateCheckpoint'],
  }),
  action({
    id: 'checkpoints.propose_move',
    capability: 'move_checkpoint',
    channels: BOT_ONLY,
    destructive: true,
    title: { es: 'Proponer mover un checkpoint', en: 'Propose moving a checkpoint' },
    summary: {
      es: 'Úsala cuando quieras cambiar la posición de un checkpoint en el mapa.',
      en: 'Use when you want to change the position of a checkpoint on the map.',
    },
    operationIds: ['listLocations', 'listCheckpoints', 'updateCheckpoint'],
  }),
  action({
    id: 'locations.propose_edit',
    capability: 'edit_location',
    title: { es: 'Proponer editar una ubicación', en: 'Propose editing a location' },
    summary: {
      es: 'Úsala cuando quieras cambiar el nombre o la dirección de una ubicación.',
      en: 'Use when you want to change the name or address of a location.',
    },
    operationIds: ['listLocations', 'updateLocation'],
  }),
  action({
    id: 'locations.propose_delete',
    capability: 'delete_location',
    channels: BOT_ONLY,
    destructive: true,
    title: { es: 'Proponer borrar una ubicación', en: 'Propose deleting a location' },
    summary: {
      es: 'Úsala cuando quieras borrar una ubicación sin checkpoints ni rutas.',
      en: 'Use when you want to delete a location with no checkpoints or routes.',
    },
    operationIds: ['listLocations', 'listCheckpoints', 'listRoutes', 'deleteLocation'],
  }),
  action({
    id: 'users.propose_invite',
    capability: 'invite_user',
    channels: BOT_ONLY,
    title: { es: 'Proponer invitar a un usuario', en: 'Propose inviting a user' },
    summary: {
      es: 'Úsala cuando quieras dar acceso al panel a una persona nueva.',
      en: 'Use when you want to give a new person access to the dashboard.',
    },
    operationIds: [
      'listLocations',
      'getOrganizationUsers',
      'getLicenseInfo',
      'createOrganizationUser',
    ],
  }),
  action({
    id: 'users.propose_change_role',
    capability: 'change_user_role',
    channels: BOT_ONLY,
    destructive: true,
    title: { es: 'Proponer cambiar el rol de un usuario', en: 'Propose changing a user role' },
    summary: {
      es: 'Úsala cuando quieras cambiar el rol de alguien que ya tiene acceso al panel.',
      en: 'Use when you want to change the role of someone who already has dashboard access.',
    },
    operationIds: ['getOrganizationUsers', 'listLocations', 'getLicenseInfo', 'updateUserRole'],
  }),
  action({
    id: 'users.propose_remove_access',
    capability: 'remove_user_access',
    channels: BOT_ONLY,
    destructive: true,
    title: { es: 'Proponer quitar el acceso a un usuario', en: 'Propose removing user access' },
    summary: {
      es: 'Úsala cuando quieras quitar a alguien el acceso al panel.',
      en: 'Use when you want to remove someone from the dashboard.',
    },
    operationIds: ['getOrganizationUsers', 'listLocations', 'deleteUserRole'],
  }),
];
