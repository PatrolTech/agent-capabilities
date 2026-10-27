import { noopLogger, type Logger } from '../../ports/Logger.js';
import type { PatrolTechGateway } from '../PatrolTechGateway.js';
import * as access from './access.js';
import * as billing from './billing.js';
import * as checkpoints from './checkpoints.js';
import * as incidents from './incidents.js';
import * as locations from './locations.js';
import * as patrollers from './patrollers.js';
import * as rounds from './rounds.js';
import * as routes from './routes.js';
import * as scans from './scans.js';
import { SdkTransport } from './transport.js';
import * as users from './users.js';

/**
 * Timeout por defecto de cada llamada: quien procesa en serie (el worker del bot)
 * no puede quedarse colgado de una petición al backend.
 */
const DEFAULT_HTTP_TIMEOUT_MS = 10_000;

export interface SdkPatrolTechGatewayOptions {
  /** Origen de la API, sin `/api` (p. ej. `https://api.patroltech.online`). */
  baseUrl: string;
  /** `fetch` inyectable (tests, instrumentación). Por defecto, el global. */
  fetchImpl?: typeof fetch;
  /** Timeout por llamada, en ms. Por defecto, 10 000. */
  timeoutMs?: number;
  logger?: Logger;
  /**
   * Cabeceras que se suman a TODAS las peticiones, calculadas en cada una (p. ej.
   * `X-Request-Id` y `X-Agent-Client` del MCP, para la auditoría). La cabecera
   * `Authorization` que den se descarta: la identidad es siempre la del token de la
   * petición. Sin ellas, no se añade nada.
   */
  defaultHeaders?: () => Record<string, string>;
}

/**
 * `PatrolTechGateway` sobre el SDK oficial `@patroltech/sdk-api`. Cada llamada lleva
 * su propia configuración (base, token, `fetch`), así que una instancia sirve a
 * cualquier número de usuarios. Solo compone: cada área vive en su módulo.
 */
export class SdkPatrolTechGateway implements PatrolTechGateway {
  private readonly t: SdkTransport;

  constructor(options: SdkPatrolTechGatewayOptions) {
    this.t = new SdkTransport({
      baseUrl: options.baseUrl,
      fetchImpl: options.fetchImpl,
      timeoutMs: options.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS,
      logger: options.logger ?? noopLogger,
      defaultHeaders: options.defaultHeaders,
    });
  }

  /** El método del área con el transporte de esta instancia (se lee al llamar, no al construir). */
  private delegate<A extends unknown[], R>(fn: (t: SdkTransport, ...a: A) => R): (...a: A) => R {
    return (...a) => fn(this.t, ...a);
  }

  // Rondas y resumen
  readonly getSupportSummary = this.delegate(rounds.getSupportSummary);
  readonly getRoundsStatus = this.delegate(rounds.getRoundsStatus);
  readonly getRoundsDetail = this.delegate(rounds.getRoundsDetail);
  readonly getRoundCheckpoints = this.delegate(rounds.getRoundCheckpoints);
  readonly getRouteRounds = this.delegate(rounds.getRouteRounds);
  readonly getRoundDetail = this.delegate(rounds.getRoundDetail);

  // Escaneos
  readonly getRecentScans = this.delegate(scans.getRecentScans);

  // Vigilantes
  readonly getPatrollerActivity = this.delegate(patrollers.getPatrollerActivity);
  readonly listPatrollers = this.delegate(patrollers.listPatrollers);
  readonly getPatrollerStats = this.delegate(patrollers.getPatrollerStats);
  readonly getPatrollerRanking = this.delegate(patrollers.getPatrollerRanking);
  readonly createPatroller = this.delegate(patrollers.createPatroller);
  readonly getPatrollerByIdentifier = this.delegate(patrollers.getPatrollerByIdentifier);
  readonly updatePatroller = this.delegate(patrollers.updatePatroller);

  // Checkpoints
  readonly getCheckpoints = this.delegate(checkpoints.getCheckpoints);
  readonly listCheckpoints = this.delegate(checkpoints.listCheckpoints);
  readonly listArchivedCheckpoints = (accountId: string, token: string) =>
    checkpoints.listCheckpoints(this.t, accountId, token, true);
  readonly createCheckpoint = this.delegate(checkpoints.createCheckpoint);
  readonly findCheckpointsByName = this.delegate(checkpoints.findCheckpointsByName);
  readonly getCheckpointDetail = this.delegate(checkpoints.getCheckpointDetail);
  readonly updateCheckpoint = this.delegate(checkpoints.updateCheckpoint);
  readonly updateCheckpointFraudRules = this.delegate(checkpoints.updateCheckpointFraudRules);
  readonly moveCheckpoint = this.delegate(checkpoints.moveCheckpoint);
  readonly archiveCheckpoint = this.delegate(checkpoints.archiveCheckpoint);
  readonly unarchiveCheckpoint = this.delegate(checkpoints.unarchiveCheckpoint);

  // Rutas
  readonly listRoutes = this.delegate(routes.listRoutes);
  readonly getRouteDetails = this.delegate(routes.getRouteDetails);
  readonly createRoute = this.delegate(routes.createRoute);
  readonly addRouteTimeWindow = this.delegate(routes.addRouteTimeWindow);
  readonly deleteRouteTimeWindow = this.delegate(routes.deleteRouteTimeWindow);
  readonly setRouteActive = this.delegate(routes.setRouteActive);
  readonly addCheckpointToRoute = this.delegate(routes.addCheckpointToRoute);
  readonly removeCheckpointFromRoute = this.delegate(routes.removeCheckpointFromRoute);

  // Ubicaciones
  readonly listLocations = this.delegate(locations.listLocations);
  readonly updateLocation = this.delegate(locations.updateLocation);
  readonly deleteLocation = this.delegate(locations.deleteLocation);

  // Incidencias
  readonly listIncidents = this.delegate(incidents.listIncidents);
  readonly getIncidentDetail = this.delegate(incidents.getIncidentDetail);
  readonly updateIncidentStatus = this.delegate(incidents.updateIncidentStatus);
  readonly assignIncident = this.delegate(incidents.assignIncident);
  readonly commentIncident = this.delegate(incidents.commentIncident);

  // Control de Acceso
  readonly listAccessLogs = this.delegate(access.listAccessLogs);
  readonly listActiveAccessEntries = this.delegate(access.listActiveAccessEntries);

  // Usuarios del panel y preferencias
  readonly setAlertPreference = this.delegate(users.setAlertPreference);
  readonly listOrgUsers = this.delegate(users.listOrgUsers);
  readonly inviteUser = this.delegate(users.inviteUser);
  readonly updateUserRole = this.delegate(users.updateUserRole);
  readonly deleteUserRole = this.delegate(users.deleteUserRole);

  // Plan y pagos
  readonly getPlanUsage = this.delegate(billing.getPlanUsage);
  readonly getPlans = this.delegate(billing.getPlans);
  readonly createCheckoutLink = this.delegate(billing.createCheckoutLink);
  readonly createCustomerPortalLink = this.delegate(billing.createCustomerPortalLink);
}
