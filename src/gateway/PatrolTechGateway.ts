import type { IncidentStatus } from '../domain/incident-status.js';
import type {
  ListaTruncable,
  RoundsStatus,
  SupportSummary,
  RoundRef,
  RoundDetail,
  RouteRoundsSummary,
  RoundCheckpointsResult,
  CheckpointRefsResult,
  CheckpointFraudRules,
  CheckpointDetail,
  CheckpointsResult,
  CheckpointMethod,
  CreatedCheckpoint,
  ArchivedCheckpointRoute,
  RouteRef,
  RouteDetails,
  NewTimeWindow,
  NewRoute,
  PatrollerActivity,
  PatrollerRef,
  PatrollerStatsResult,
  PatrollerRanking,
  CreatedPatroller,
  AlertType,
  AlertChannel,
  IncidentRef,
  IncidentTarget,
  IncidentDetail,
  OrgUser,
  NewOrgUser,
  InviteResult,
  LocationRef,
  PlanUsage,
  PaidPlan,
  CheckoutLinkInput,
  AccessLogQuery,
  AccessLogEntry,
  RecentScan,
  ScanQuery,
} from './types/index.js';

/**
 * Puerto de lectura/escritura contra la API de PatrolTech. Lo implementa cada
 * consumidor (cliente HTTP del bot, SDK en el servidor MCP) y lo sustituye
 * `FakePatrolTechGateway` en los tests. El `token` va por llamada: el puerto no
 * guarda credenciales.
 */
export interface PatrolTechGateway {
  getRoundsStatus(accountId: string, token: string): Promise<RoundsStatus>;
  getPatrollerActivity(
    accountId: string,
    token: string
  ): Promise<ListaTruncable<PatrollerActivity>>;
  getSupportSummary(accountId: string, token: string, windowDays?: number): Promise<SupportSummary>;
  getRecentScans(
    accountId: string,
    token: string,
    opts?: ScanQuery
  ): Promise<ListaTruncable<RecentScan>>;
  getRoundsDetail(accountId: string, token: string): Promise<ListaTruncable<RouteRoundsSummary>>;
  getPatrollerStats(
    accountId: string,
    token: string,
    patrollerName: string
  ): Promise<PatrollerStatsResult>;
  getRoundCheckpoints(
    accountId: string,
    token: string,
    routeName?: string
  ): Promise<RoundCheckpointsResult>;
  getCheckpoints(accountId: string, token: string): Promise<CheckpointsResult>;
  getPatrollerRanking(
    accountId: string,
    token: string,
    opts?: { dateFrom?: string; dateTo?: string }
  ): Promise<PatrollerRanking>;
  listLocations(accountId: string, token: string): Promise<LocationRef[]>;
  listPatrollers(accountId: string, token: string): Promise<ListaTruncable<PatrollerRef>>;
  listRoutes(accountId: string, token: string): Promise<ListaTruncable<RouteRef>>;
  listCheckpoints(accountId: string, token: string): Promise<CheckpointRefsResult>;
  /** Una página de rondas de la ruta, de la más reciente a la más antigua. */
  getRouteRounds(
    routeId: string,
    token: string,
    page: { page: number; limit: number }
  ): Promise<{ items: RoundRef[]; totalPages: number }>;
  getRoundDetail(routeId: string, roundId: string, token: string): Promise<RoundDetail>;
  getPlanUsage(accountId: string, token: string): Promise<PlanUsage>;
  /**
   * Planes de pago (Pro, Business) con sus precios en la moneda que decide el backend.
   * El catálogo es público: sin organización ni token (un prospecto) también responde;
   * con organización, en SU moneda. `country` (ISO-2) manda sobre la IP de quien llama.
   */
  getPlans(
    accountId: string | null,
    token: string | null,
    country?: string | null
  ): Promise<PaidPlan[]>;
  /**
   * URL del checkout de Stripe para contratar un plan. SOLO para una
   * organización que aún no paga: el checkout crea una suscripción nueva (el
   * backend rechaza a quien ya paga). Generarla no cobra nada. Solo ADMIN de la organización.
   */
  createCheckoutLink(accountId: string, input: CheckoutLinkInput, token: string): Promise<string>;
  /** URL del portal de Stripe de quien ya paga (facturas, tarjeta, cancelar). Solo ADMIN de la organización. */
  createCustomerPortalLink(accountId: string, returnUrl: string, token: string): Promise<string>;
  /** null si no existe (404). */
  getRouteDetails(routeId: string, token: string): Promise<RouteDetails | null>;

  // Escrituras: solo las llama el motor de acciones tras la confirmación del cliente.
  /** `POST /api/checkpoints` con el código vacío (lo genera el servidor). Nunca con `confirmExtraBilling`. */
  createCheckpoint(
    input: { name: string; locationId: string; metodo: CheckpointMethod },
    token: string
  ): Promise<CreatedCheckpoint>;
  /** Checkpoints de la ubicación cuyo nombre contiene `name` (`search` del backend), para recuperar un alta dudosa. */
  findCheckpointsByName(
    locationId: string,
    name: string,
    token: string
  ): Promise<CreatedCheckpoint[]>;
  /** `POST /api/patrollers` con el `identifier` que genera el bot. */
  createPatroller(
    input: { organizationId: string; name: string; identifier: string; phone?: string },
    token: string
  ): Promise<CreatedPatroller>;
  /** null si no existe (404). */
  getPatrollerByIdentifier(identifier: string, token: string): Promise<CreatedPatroller | null>;
  /**
   * `PATCH /api/auth/user/preferences` con SOLO ese tipo y canal: el backend
   * fusiona `channels` con lo que ya tenía el usuario (no borra los demás).
   */
  setAlertPreference(
    input: { tipo: AlertType; canal: AlertChannel; activar: boolean },
    token: string
  ): Promise<void>;
  /** `POST /api/routes/complete`: la ruta con sus checkpoints y horarios en una sola operación (400 si dos horarios se solapan). */
  createRoute(input: NewRoute, token: string): Promise<{ id: string; name: string }>;
  /** `POST /api/routes/:routeId/timewindows` (400 si se solapa con otro de la ruta). */
  addRouteTimeWindow(routeId: string, window: NewTimeWindow, token: string): Promise<void>;
  /** `DELETE /api/routes/timewindows/:id`. */
  deleteRouteTimeWindow(timeWindowId: string, token: string): Promise<void>;
  /** `PATCH /api/routes/:id/active`. */
  setRouteActive(routeId: string, isActive: boolean, token: string): Promise<void>;
  /** `POST /api/routes/:routeId/checkpoints/:checkpointId` con su posición (1 = el primero). */
  addCheckpointToRoute(
    routeId: string,
    checkpointId: string,
    order: number,
    token: string
  ): Promise<void>;
  /** `DELETE /api/routes/:routeId/checkpoints/:checkpointId`. */
  removeCheckpointFromRoute(routeId: string, checkpointId: string, token: string): Promise<void>;

  // Incidencias, ediciones y usuarios.
  /**
   * Incidencias de la organización, de la más reciente a la más antigua. Lanza
   * 403 «Feature 'incident-reporting' is not enabled» si la App está apagada
   * (ver `isFeatureDisabled`).
   */
  listIncidents(
    accountId: string,
    token: string,
    opts?: { estado?: IncidentStatus }
  ): Promise<ListaTruncable<IncidentRef>>;
  /** `PATCH …/incidents/:id/status`; `comentario` obligatorio para RESOLVED y DISCARDED. */
  updateIncidentStatus(
    input: IncidentTarget & { estado: IncidentStatus; comentario?: string },
    token: string
  ): Promise<void>;
  /** `PATCH …/incidents/:id/assign`. */
  assignIncident(input: IncidentTarget & { userId: string }, token: string): Promise<void>;
  /** `POST …/incidents/:id/comments`. */
  commentIncident(input: IncidentTarget & { comentario: string }, token: string): Promise<void>;
  /** `GET /api/organizations/users` (solo ADMIN de la organización: 403 al resto). */
  listOrgUsers(accountId: string, token: string): Promise<OrgUser[]>;
  /** `PUT /api/patrollers/:id` solo con los campos que cambian. */
  updatePatroller(
    input: { id: string; name?: string; phone?: string },
    token: string
  ): Promise<CreatedPatroller>;
  /** `PUT /api/checkpoints/:id` solo con nombre y descripción: nunca el código ni el método. */
  updateCheckpoint(
    input: { id: string; name?: string; description?: string },
    token: string
  ): Promise<void>;
  /**
   * `POST /api/checkpoints/:id/archive`. Devuelve las rutas de las que se ha
   * quitado (`affectedRoutes`), o null si el backend no las manda.
   */
  archiveCheckpoint(id: string, token: string): Promise<ArchivedCheckpointRoute[] | null>;
  /** `POST /api/checkpoints/:id/unarchive`, sin `confirmExtraBilling`: el backend aplica el gate del plan (402/409). */
  unarchiveCheckpoint(id: string, token: string): Promise<void>;
  /** Checkpoints ARCHIVADOS de todas las ubicaciones de la organización. */
  listArchivedCheckpoints(accountId: string, token: string): Promise<CheckpointRefsResult>;

  // Antifraude y posición del checkpoint.
  /**
   * Posición y reglas antifraude de un checkpoint de esa ubicación. No hay `GET /api/checkpoints/:id`:
   * sale de la lista de la ubicación buscando por su nombre. null si ya no está.
   */
  getCheckpointDetail(
    input: { id: string; locationId: string; name: string },
    token: string
  ): Promise<CheckpointDetail | null>;
  /** `PUT /api/checkpoints/:id` solo con `fraudRules`: el backend REEMPLAZA el objeto entero (null = sin reglas). */
  updateCheckpointFraudRules(
    input: { id: string; fraudRules: CheckpointFraudRules | null },
    token: string
  ): Promise<void>;
  /** `PUT /api/checkpoints/:id` solo con `latitude` y `longitude`. */
  moveCheckpoint(
    input: { id: string; latitude: number; longitude: number },
    token: string
  ): Promise<void>;

  // Lecturas de incidencias y del Control de Acceso.
  /**
   * `GET …/incidents/:id` con la ubicación (o la organización) en la query, igual
   * que las escrituras. null si no existe (404). Sin URLs de adjuntos: están
   * firmadas y no deben llegar al modelo.
   */
  getIncidentDetail(target: IncidentTarget, token: string): Promise<IncidentDetail | null>;
  /**
   * `GET /api/features/access-control/access-logs`, del más reciente al más
   * antiguo. Lanza 403 «Feature 'access-control' is not enabled» si la App está
   * apagada (ver `isFeatureDisabled`).
   */
  listAccessLogs(
    query: AccessLogQuery,
    token: string
  ): Promise<{ items: AccessLogEntry[]; total: number }>;
  /** `GET …/access-logs/active`: quién ha entrado en la ubicación y aún no ha salido. */
  listActiveAccessEntries(
    locationId: string,
    token: string,
    zona?: string
  ): Promise<AccessLogEntry[]>;

  // Ubicaciones y usuarios del panel.
  /** `PUT /api/locations/:id` SOLO con nombre y/o dirección: el backend no filtra el body. */
  updateLocation(
    input: { id: string; name?: string; address?: string },
    token: string
  ): Promise<void>;
  /** `DELETE /api/locations/:id`: borra la ubicación con sus checkpoints, rutas y rondas. Irreversible. */
  deleteLocation(id: string, token: string): Promise<void>;
  /** `POST /api/organizations/users` (solo ADMIN de la organización; 402 `USER_LIMIT_REACHED` si no quedan asientos de gestor). */
  inviteUser(input: NewOrgUser, token: string): Promise<InviteResult>;

  // Roles de quien ya está en el panel. El `userRoleId` sale SOLO de `listOrgUsers` de la organización.
  /**
   * `PUT /api/user-roles/:userRoleId` solo con `roleType` (ADMIN de la organización del rol; 402
   * `USER_LIMIT_REACHED` al subir un VIEWER sin asientos de gestor; 404 si ya no existe).
   */
  updateUserRole(
    input: { userRoleId: string; roleType: 'VIEWER' | 'EDITOR' | 'ADMIN' },
    token: string
  ): Promise<void>;
  /** `DELETE /api/user-roles/:userRoleId`: quita ese acceso (la cuenta de la persona sigue existiendo). 404 si ya no existe. */
  deleteUserRole(userRoleId: string, token: string): Promise<void>;
}
