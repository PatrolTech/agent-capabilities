/* eslint-disable @typescript-eslint/require-await -- el fake implementa un puerto asíncrono con datos en memoria: los métodos son async sin esperar nada. */
import type { IncidentStatus } from '../domain/incident-status.js';
import type {
  PatrolTechGateway,
  ArchivedCheckpointRoute,
  RoundsStatus,
  PatrollerActivity,
  SupportSummary,
  RecentScan,
  RouteRoundsSummary,
  PatrollerStatsResult,
  RoundCheckpointsResult,
  CheckpointInfo,
  CheckpointsResult,
  ListaTruncable,
  PatrollerRanking,
  ScanQuery,
  LocationRef,
  PatrollerRef,
  RouteRef,
  CheckpointRef,
  CheckpointRefsResult,
  CheckpointDetail,
  CheckpointFraudRules,
  RoundRef,
  RoundDetail,
  PlanUsage,
  PaidPlan,
  CheckoutLinkInput,
  CheckpointMethod,
  CreatedCheckpoint,
  CreatedPatroller,
  AlertType,
  AlertChannel,
  RouteDetails,
  NewRoute,
  NewTimeWindow,
  IncidentRef,
  IncidentTarget,
  IncidentDetail,
  AccessLogEntry,
  AccessLogQuery,
  OrgUser,
  NewOrgUser,
  InviteResult,
} from '../gateway/index.js';
import { explainScan } from '../domain/scan-explanation.js';

export class FakePatrolTechGateway implements PatrolTechGateway {
  readonly calls: string[] = [];
  readonly tokens: string[] = [];
  /** Si true, las listas se devuelven marcadas como truncadas (para probar el aviso al modelo). */
  truncado = false;
  /** Opciones (rango, límite y filtros ya resueltos a id) con las que se pidieron los escaneos. */
  readonly scanOpts: (ScanQuery | undefined)[] = [];
  /** Páginas de rondas pedidas (`<routeId>:<page>`) y rondas cuyo detalle se pidió. */
  readonly roundPageCalls: string[] = [];
  readonly roundDetailCalls: string[] = [];

  /** Escrituras recibidas (lo que se mandó al backend), en orden. */
  readonly writes: { op: string; input: unknown; token: string }[] = [];
  /** Errores que lanzan las siguientes escrituras (uno por llamada, en orden). */
  writeErrors: Error[] = [];
  /** Checkpoints que devuelve `findCheckpointsByName` (filtrados por ubicación y nombre). */
  existingCheckpoints: CreatedCheckpoint[] = [];
  /** Vigilantes que devuelve `getPatrollerByIdentifier`. */
  existingPatrollers: CreatedPatroller[] = [];

  locations: LocationRef[] = [
    { id: 'loc-central', name: 'Sede Central' },
    { id: 'loc-norte', name: 'Sucursal Norte' },
  ];
  patrollers: PatrollerRef[] = [
    {
      id: 'p-juan',
      name: 'Juan Pérez',
      identifier: 'A1B2C3D4',
      lastScanAt: '2026-07-22T08:00:00Z',
    },
    { id: 'p-ana', name: 'Ana López', identifier: 'E5F6A7B8', lastScanAt: null },
  ];
  routes: RouteRef[] = [
    { id: 'r-norte', name: 'Ruta Norte', isActive: true },
    { id: 'r-sur', name: 'Ruta Sur', isActive: false },
  ];
  /** `codigo: null` en un QR = el usuario no es EDITOR de esa ubicación (el backend lo oculta). */
  checkpointRefs: CheckpointRef[] = [
    {
      id: 'cp-entrada',
      name: 'Entrada principal',
      locationId: 'loc-central',
      locationName: 'Sede Central',
      metodo: 'qr_static',
      codigo: 'PT-ENTRADA01',
    },
    {
      id: 'cp-almacen',
      name: 'Almacén',
      locationId: 'loc-central',
      locationName: 'Sede Central',
      metodo: 'manual_code',
      codigo: 'ALM-1234',
    },
    {
      id: 'cp-recepcion',
      name: 'Recepción',
      locationId: 'loc-norte',
      locationName: 'Sucursal Norte',
      metodo: 'qr_static',
      codigo: null,
    },
  ];
  /** Detalle de cada ruta (checkpoints y horarios en UTC); una ruta sin entrada no existe (404). */
  routeDetails: Record<string, RouteDetails> = {
    'r-norte': {
      id: 'r-norte',
      name: 'Ruta Norte',
      isActive: true,
      locationId: 'loc-central',
      checkpoints: [{ checkpointId: 'cp-entrada', order: 1 }],
      timeWindows: [{ id: 'tw-1', startTime: '18:00', endTime: '19:00', days: [1, 2, 3, 4, 5] }],
    },
  };
  /** Rondas por ruta, de la más reciente a la más antigua (como las devuelve el backend). */
  rounds: Record<string, RoundRef[]> = {
    'r-norte': [
      {
        id: 'rd-3',
        status: 'in_progress',
        patrollerName: 'Juan Pérez',
        completedCheckpoints: 1,
        totalCheckpoints: 3,
        startTime: '2026-07-29T20:00:00Z',
        endTime: null,
      },
      {
        id: 'rd-2',
        status: 'incomplete',
        patrollerName: 'Ana López',
        completedCheckpoints: 2,
        totalCheckpoints: 3,
        startTime: '2026-07-28T21:00:00Z',
        endTime: '2026-07-28T22:00:00Z',
      },
      {
        id: 'rd-1',
        status: 'completed',
        patrollerName: 'Juan Pérez',
        completedCheckpoints: 3,
        totalCheckpoints: 3,
        startTime: '2026-07-20T06:00:00Z',
        endTime: '2026-07-20T07:00:00Z',
      },
    ],
  };
  scans: RecentScan[] = [
    {
      timestamp: '2026-07-29T08:00:00Z',
      checkpointName: 'Entrada principal',
      patrollerName: 'Juan Pérez',
      fraudFlagged: false,
      ...explainScan({
        validationStatus: 'verified',
        validationReason: null,
        fraudFlags: { flagged: false },
      }),
    },
    {
      timestamp: '2026-07-29T07:45:00Z',
      checkpointName: 'Almacén',
      patrollerName: 'Ana López',
      fraudFlagged: true,
      ...explainScan({
        validationStatus: 'pending_review',
        validationReason: 'untyped_scan_on_protected_checkpoint',
        fraudFlags: { flagged: true, gpsProximity: { status: 'fail' } },
      }),
    },
  ];
  planUsage: PlanUsage = {
    plan: 'Free',
    estadoLicencia: 'active',
    pagaSuscripcion: false,
    uso: {
      checkpoints: { usados: 7, incluidos: 7, extraFacturados: 0 },
      ubicaciones: { usadas: 2, limite: 2 },
      gestores: { usados: 3, limite: 3 },
    },
  };
  /** Rangos (dateFrom/dateTo) con los que se pidió el ranking. */
  readonly rankingOpts: ({ dateFrom?: string; dateTo?: string } | undefined)[] = [];

  supportSummary: SupportSummary = {
    rounds: { windowDays: 7, inProgress: 2, completed: 15, incomplete: 1, expired: 0 },
    patrollers: { total: 8, active: 6, inactive: 1, alert: 1 },
    checkpoints: { total: 24 },
    suspiciousScans: { windowDays: 7, flagged: 0 },
  };

  async getRoundsStatus(accountId: string, token: string): Promise<RoundsStatus> {
    const summary = await this.getSupportSummary(accountId, token);
    return {
      windowDays: summary.rounds.windowDays,
      open: summary.rounds.inProgress,
      completed: summary.rounds.completed,
      incomplete: summary.rounds.incomplete + summary.rounds.expired,
    };
  }

  async getPatrollerActivity(
    accountId: string,
    token: string
  ): Promise<ListaTruncable<PatrollerActivity>> {
    this.calls.push(accountId);
    this.tokens.push(token);
    const items: PatrollerActivity[] = [
      { name: 'Juan Pérez', lastScanAt: '2026-07-22T08:00:00Z', status: 'active' },
      { name: 'Ana López', lastScanAt: null, status: 'alert' },
    ];
    return { items, total: items.length, truncado: this.truncado };
  }

  async getSupportSummary(
    accountId: string,
    token: string,
    _windowDays?: number
  ): Promise<SupportSummary> {
    this.calls.push(accountId);
    this.tokens.push(token);
    return this.supportSummary;
  }

  async getRecentScans(
    accountId: string,
    token: string,
    opts?: ScanQuery
  ): Promise<ListaTruncable<RecentScan>> {
    this.calls.push(accountId);
    this.tokens.push(token);
    this.scanOpts.push(opts);
    // Nota: la fake ignora las fechas y los filtros (se comprueban en `scanOpts`), pero respeta limit y page.
    const scans = this.scans;
    const inicio = opts?.limit ? ((opts.page ?? 1) - 1) * opts.limit : 0;
    const items = opts?.limit ? scans.slice(inicio, inicio + opts.limit) : scans;
    return { items, total: scans.length, truncado: this.truncado || items.length < scans.length };
  }

  async getRoundsDetail(
    accountId: string,
    token: string
  ): Promise<ListaTruncable<RouteRoundsSummary>> {
    this.calls.push(accountId);
    this.tokens.push(token);
    const items: RouteRoundsSummary[] = [
      {
        routeName: 'Ruta Norte',
        isActive: true,
        rounds: [
          {
            status: 'completed',
            patrollerName: 'Juan Pérez',
            completedCheckpoints: 6,
            totalCheckpoints: 6,
            startTime: '2026-07-29T06:00:00Z',
            endTime: '2026-07-29T07:00:00Z',
          },
        ],
      },
      {
        routeName: 'Ruta Sur',
        isActive: false,
        rounds: [],
      },
    ];
    return { items, total: items.length, truncado: this.truncado };
  }

  async getPatrollerStats(
    accountId: string,
    token: string,
    patrollerName: string
  ): Promise<PatrollerStatsResult> {
    this.calls.push(accountId);
    this.tokens.push(token);
    const lower = patrollerName.trim().toLowerCase();
    // Vacío no resuelve a nadie: mismo invariante que el cliente real.
    if (!lower) return { found: false, opciones: ['Juan García', 'María López'] };
    if (lower === 'juan garcía' || lower === 'juan garcia' || lower.includes('juan')) {
      return {
        found: true,
        name: 'Juan García',
        totalScans: 42,
        roundsCompleted: 8,
        totalRounds: 10,
        completionRate: 0.8,
        avgTimeBetweenScans: 15.5,
        incidentsReported: 3,
        incidentsOpen: 1,
      };
    }
    return { found: false, opciones: ['Juan García', 'María López'] };
  }

  async getRoundCheckpoints(
    accountId: string,
    token: string,
    routeName?: string
  ): Promise<RoundCheckpointsResult> {
    this.calls.push(accountId);
    this.tokens.push(token);
    if (!routeName?.trim()) {
      return { found: false, reason: 'route_not_specified', opciones: ['Ruta Norte', 'Ruta Sur'] };
    }
    const lower = routeName.trim().toLowerCase();
    if (lower === 'ruta norte' || lower.includes('norte')) {
      return {
        found: true,
        routeName: 'Ruta Norte',
        status: 'incomplete',
        scannedCount: 2,
        totalCount: 3,
        checkpoints: [
          {
            checkpointName: 'Entrada principal',
            order: 1,
            scanned: true,
            scanTime: '2026-07-29T06:05:00Z',
          },
          { checkpointName: 'Almacén', order: 2, scanned: true, scanTime: '2026-07-29T06:20:00Z' },
          { checkpointName: 'Azotea', order: 3, scanned: false, scanTime: null },
        ],
      };
    }
    return { found: false, reason: 'route_not_found', opciones: ['Ruta Norte', 'Ruta Sur'] };
  }

  async getCheckpoints(accountId: string, token: string): Promise<CheckpointsResult> {
    this.calls.push(accountId);
    this.tokens.push(token);
    // Los mismos checkpoints que `listCheckpoints` (por defecto: Entrada principal, Almacén y Recepción).
    const items: CheckpointInfo[] = this.checkpointRefs.map((c) => ({
      id: c.id,
      name: c.name,
      locationName: c.locationName,
      ...(c.identificador ? { identificador: c.identificador } : {}),
    }));
    return { items, total: items.length, truncado: this.truncado, ubicacionesConError: 0 };
  }

  async getPatrollerRanking(
    accountId: string,
    token: string,
    opts?: { dateFrom?: string; dateTo?: string }
  ): Promise<PatrollerRanking> {
    this.calls.push(accountId);
    this.tokens.push(token);
    this.rankingOpts.push(opts);
    return {
      truncado: this.truncado,
      summary: {
        totalScans: 87,
        activePatrollers: 3,
        avgScansPerPatroller: 29,
        bestCompletionRate: 0.95,
      },
      ranking: [
        {
          patrollerName: 'Juan García',
          totalScans: 42,
          roundsCompleted: 8,
          completionRate: 0.95,
          avgTimeBetweenScans: 15.5,
        },
        {
          patrollerName: 'María López',
          totalScans: 30,
          roundsCompleted: 6,
          completionRate: 0.8,
          avgTimeBetweenScans: 18.2,
        },
        {
          patrollerName: 'Ana López',
          totalScans: 15,
          roundsCompleted: 3,
          completionRate: 0.6,
          avgTimeBetweenScans: 25.0,
        },
      ],
      topCheckpoints: [
        { checkpointName: 'Entrada principal', totalScans: 30 },
        { checkpointName: 'Almacén', totalScans: 22 },
      ],
    };
  }

  async listLocations(accountId: string, token: string): Promise<LocationRef[]> {
    this.calls.push(accountId);
    this.tokens.push(token);
    return this.locations;
  }

  async listPatrollers(accountId: string, token: string): Promise<ListaTruncable<PatrollerRef>> {
    this.calls.push(accountId);
    this.tokens.push(token);
    return { items: this.patrollers, total: this.patrollers.length, truncado: this.truncado };
  }

  async listRoutes(accountId: string, token: string): Promise<ListaTruncable<RouteRef>> {
    this.calls.push(accountId);
    this.tokens.push(token);
    return { items: this.routes, total: this.routes.length, truncado: this.truncado };
  }

  async listCheckpoints(accountId: string, token: string): Promise<CheckpointRefsResult> {
    this.calls.push(accountId);
    this.tokens.push(token);
    return {
      items: this.checkpointRefs,
      total: this.checkpointRefs.length,
      truncado: this.truncado,
      ubicacionesConError: 0,
    };
  }

  async getRouteRounds(
    routeId: string,
    token: string,
    { page, limit }: { page: number; limit: number }
  ): Promise<{ items: RoundRef[]; totalPages: number }> {
    this.tokens.push(token);
    this.roundPageCalls.push(`${routeId}:${page}`);
    const all = this.rounds[routeId] ?? [];
    return {
      items: all.slice((page - 1) * limit, page * limit),
      totalPages: Math.ceil(all.length / limit),
    };
  }

  async getRoundDetail(_routeId: string, roundId: string, token: string): Promise<RoundDetail> {
    this.tokens.push(token);
    this.roundDetailCalls.push(roundId);
    return {
      status: 'incomplete',
      scannedCount: 2,
      totalCount: 3,
      checkpoints: [
        {
          checkpointName: 'Entrada principal',
          order: 1,
          scanned: true,
          scanTime: '2026-07-28T21:05:00Z',
        },
        { checkpointName: 'Almacén', order: 2, scanned: true, scanTime: '2026-07-28T21:20:00Z' },
        { checkpointName: 'Azotea', order: 3, scanned: false, scanTime: null },
      ],
    };
  }

  async getPlanUsage(accountId: string, token: string): Promise<PlanUsage> {
    this.calls.push(accountId);
    this.tokens.push(token);
    return this.planUsage;
  }

  plans: PaidPlan[] = [
    {
      tierId: 'tier-pro',
      nombre: 'Pro',
      identificador: 'pro',
      moneda: 'EUR',
      checkpointsIncluidos: 12,
      mensual: { base: 11, extra: 3 },
      anual: { base: 110, extra: 30 },
    },
    {
      tierId: 'tier-business',
      nombre: 'Business',
      identificador: 'business',
      moneda: 'EUR',
      checkpointsIncluidos: 48,
      mensual: { base: 22, extra: 4 },
      anual: { base: 220, extra: 40 },
    },
  ];
  /** Enlaces de pago pedidos (checkout y portal), en orden. */
  readonly paymentLinks: (
    | { op: 'checkout'; accountId: string; input: CheckoutLinkInput }
    | { op: 'portal'; accountId: string; returnUrl: string }
  )[] = [];
  /** Error que lanzan los enlaces de pago (p. ej. 403 a quien no es Admin). */
  paymentLinkError: Error | null = null;
  /** Error que lanza solo el checkout (p. ej. 409 `ALREADY_SUBSCRIBED` a quien ya paga). */
  checkoutError: Error | null = null;
  checkoutUrl = 'https://checkout.stripe.com/c/pay/cs_test_fake';
  portalUrl = 'https://billing.stripe.com/p/session/test_fake';

  /** Consultas al catálogo de precios, en orden (organización y país que se pidieron). */
  readonly plansQueries: { accountId: string | null; country: string | null }[] = [];
  /** Error que lanza el catálogo de precios (backend caído). */
  plansError: Error | null = null;

  async getPlans(
    accountId: string | null,
    token: string | null,
    country?: string | null
  ): Promise<PaidPlan[]> {
    this.plansQueries.push({ accountId, country: country ?? null });
    if (accountId) this.calls.push(accountId);
    if (token) this.tokens.push(token);
    if (this.plansError) throw this.plansError;
    return this.plans;
  }

  async createCheckoutLink(
    accountId: string,
    input: CheckoutLinkInput,
    token: string
  ): Promise<string> {
    this.tokens.push(token);
    this.paymentLinks.push({ op: 'checkout', accountId, input });
    if (this.paymentLinkError) throw this.paymentLinkError;
    if (this.checkoutError) throw this.checkoutError;
    return this.checkoutUrl;
  }

  async createCustomerPortalLink(
    accountId: string,
    returnUrl: string,
    token: string
  ): Promise<string> {
    this.tokens.push(token);
    this.paymentLinks.push({ op: 'portal', accountId, returnUrl });
    if (this.paymentLinkError) throw this.paymentLinkError;
    return this.portalUrl;
  }

  private write(op: string, input: unknown, token: string): void {
    this.writes.push({ op, input, token });
    const err = this.writeErrors.shift();
    if (err) throw err;
  }

  async createCheckpoint(
    input: { name: string; locationId: string; metodo: CheckpointMethod },
    token: string
  ): Promise<CreatedCheckpoint> {
    this.write('createCheckpoint', input, token);
    return {
      id: 'cp-new',
      name: input.name,
      locationId: input.locationId,
      metodo: input.metodo,
      codigo: 'PT-NEW0000001',
      creadoEn: new Date().toISOString(),
    };
  }

  async findCheckpointsByName(
    locationId: string,
    name: string,
    token: string
  ): Promise<CreatedCheckpoint[]> {
    this.tokens.push(token);
    return this.existingCheckpoints.filter(
      (c) => c.locationId === locationId && c.name.toLowerCase().includes(name.toLowerCase())
    );
  }

  async createPatroller(
    input: { organizationId: string; name: string; identifier: string; phone?: string },
    token: string
  ): Promise<CreatedPatroller> {
    this.write('createPatroller', input, token);
    return {
      id: 'p-new',
      name: input.name,
      identifier: input.identifier,
      organizationId: input.organizationId,
    };
  }

  async getPatrollerByIdentifier(
    identifier: string,
    token: string
  ): Promise<CreatedPatroller | null> {
    this.tokens.push(token);
    return this.existingPatrollers.find((p) => p.identifier === identifier) ?? null;
  }

  async setAlertPreference(
    input: { tipo: AlertType; canal: AlertChannel; activar: boolean },
    token: string
  ): Promise<void> {
    this.write('setAlertPreference', input, token);
  }

  async getRouteDetails(routeId: string, token: string): Promise<RouteDetails | null> {
    this.tokens.push(token);
    return this.routeDetails[routeId] ?? null;
  }

  async createRoute(input: NewRoute, token: string): Promise<{ id: string; name: string }> {
    this.write('createRoute', input, token);
    return { id: input.id, name: input.name };
  }

  async addRouteTimeWindow(routeId: string, window: NewTimeWindow, token: string): Promise<void> {
    this.write('addRouteTimeWindow', { routeId, ...window }, token);
  }

  async deleteRouteTimeWindow(timeWindowId: string, token: string): Promise<void> {
    this.write('deleteRouteTimeWindow', { timeWindowId }, token);
  }

  async setRouteActive(routeId: string, isActive: boolean, token: string): Promise<void> {
    this.write('setRouteActive', { routeId, isActive }, token);
  }

  async addCheckpointToRoute(
    routeId: string,
    checkpointId: string,
    order: number,
    token: string
  ): Promise<void> {
    this.write('addCheckpointToRoute', { routeId, checkpointId, order }, token);
  }

  async removeCheckpointFromRoute(
    routeId: string,
    checkpointId: string,
    token: string
  ): Promise<void> {
    this.write('removeCheckpointFromRoute', { routeId, checkpointId }, token);
  }

  // Incidencias, ediciones y usuarios ---------------------------------------

  incidents: IncidentRef[] = [
    {
      id: 'inc-1',
      titulo: 'Puerta del almacén forzada',
      estado: 'OPEN',
      prioridad: 'HIGH',
      locationId: 'loc-central',
      asignadoAId: null,
      asignadoA: null,
      creadaEn: '2026-07-29T09:00:00Z',
    },
    {
      id: 'inc-2',
      titulo: 'Luz fundida en recepción',
      estado: 'IN_PROGRESS',
      prioridad: 'LOW',
      locationId: 'loc-norte',
      asignadoAId: 'u-marta',
      asignadoA: 'Marta Ruiz',
      creadaEn: '2026-07-28T20:00:00Z',
    },
    {
      id: 'inc-3',
      titulo: 'Cámara rota',
      estado: 'CLOSED',
      prioridad: 'MEDIUM',
      locationId: 'loc-central',
      asignadoAId: 'u-marta',
      asignadoA: 'Marta Ruiz',
      creadaEn: '2026-07-20T08:00:00Z',
    },
  ];
  /** Error que lanza `listIncidents` (p. ej. la App de incidencias apagada). */
  incidentsError: Error | null = null;
  /** Estados con los que se pidieron las incidencias. */
  readonly incidentOpts: ({ estado?: IncidentStatus } | undefined)[] = [];
  orgUsers: OrgUser[] = [
    {
      id: 'u-marta',
      nombre: 'Marta Ruiz',
      email: 'marta@acme.test',
      roles: [{ id: 'r-marta', rol: 'ADMIN', ambito: 'ORGANIZATION', scopeId: 'org-1' }],
    },
    {
      id: 'u-pedro',
      nombre: 'Pedro Gil',
      email: 'pedro@acme.test',
      roles: [{ id: 'r-pedro', rol: 'VIEWER', ambito: 'LOCATION', scopeId: 'loc-norte' }],
    },
  ];
  /** Error que lanza `listOrgUsers` (p. ej. 403 a quien no es Admin). */
  orgUsersError: Error | null = null;
  archivedCheckpointRefs: CheckpointRef[] = [
    {
      id: 'cp-viejo',
      name: 'Garaje',
      locationId: 'loc-central',
      locationName: 'Sede Central',
      metodo: 'qr_static',
      codigo: 'PT-GARAJE01',
    },
  ];

  async listIncidents(
    accountId: string,
    token: string,
    opts?: { estado?: IncidentStatus }
  ): Promise<ListaTruncable<IncidentRef>> {
    this.calls.push(accountId);
    this.tokens.push(token);
    this.incidentOpts.push(opts);
    if (this.incidentsError) throw this.incidentsError;
    const items = opts?.estado
      ? this.incidents.filter((i) => i.estado === opts.estado)
      : this.incidents;
    return { items, total: items.length, truncado: this.truncado };
  }

  async updateIncidentStatus(
    input: IncidentTarget & { estado: IncidentStatus; comentario?: string },
    token: string
  ): Promise<void> {
    this.write('updateIncidentStatus', input, token);
  }

  async assignIncident(input: IncidentTarget & { userId: string }, token: string): Promise<void> {
    this.write('assignIncident', input, token);
  }

  async commentIncident(
    input: IncidentTarget & { comentario: string },
    token: string
  ): Promise<void> {
    this.write('commentIncident', input, token);
  }

  async listOrgUsers(accountId: string, token: string): Promise<OrgUser[]> {
    this.calls.push(accountId);
    this.tokens.push(token);
    if (this.orgUsersError) throw this.orgUsersError;
    return this.orgUsers;
  }

  async updatePatroller(
    input: { id: string; name?: string; phone?: string },
    token: string
  ): Promise<CreatedPatroller> {
    this.write('updatePatroller', input, token);
    const p = this.patrollers.find((x) => x.id === input.id);
    return {
      id: input.id,
      name: input.name ?? p?.name ?? '',
      identifier: p?.identifier ?? '',
      organizationId: 'org-1',
    };
  }

  async updateCheckpoint(
    input: { id: string; name?: string; description?: string },
    token: string
  ): Promise<void> {
    this.write('updateCheckpoint', input, token);
  }

  /** Lo que devuelve `archiveCheckpoint`: las rutas afectadas según el backend (null = no las manda). */
  archiveResult: ArchivedCheckpointRoute[] | null = null;

  async archiveCheckpoint(id: string, token: string): Promise<ArchivedCheckpointRoute[] | null> {
    this.write('archiveCheckpoint', { id }, token);
    return this.archiveResult;
  }

  async unarchiveCheckpoint(id: string, token: string): Promise<void> {
    this.write('unarchiveCheckpoint', { id }, token);
  }

  async listArchivedCheckpoints(accountId: string, token: string): Promise<CheckpointRefsResult> {
    this.calls.push(accountId);
    this.tokens.push(token);
    return {
      items: this.archivedCheckpointRefs,
      total: this.archivedCheckpointRefs.length,
      truncado: false,
      ubicacionesConError: 0,
    };
  }

  // Antifraude y posición del checkpoint -----------------------------------

  /** Posición y reglas por id de checkpoint; sin entrada = sin coordenadas ni reglas. Las escrituras las actualizan. */
  checkpointGeo: Record<
    string,
    Partial<
      Pick<CheckpointDetail, 'latitud' | 'longitud' | 'reglasAntifraude' | 'reglasDesconocidas'>
    >
  > = {};

  async getCheckpointDetail(
    input: { id: string; locationId: string; name: string },
    token: string
  ): Promise<CheckpointDetail | null> {
    this.tokens.push(token);
    const cp = this.checkpointRefs.find(
      (c) => c.id === input.id && c.locationId === input.locationId
    );
    if (!cp) return null;
    const g = this.checkpointGeo[cp.id] ?? {};
    return {
      id: cp.id,
      name: cp.name,
      locationId: cp.locationId,
      metodo: cp.metodo,
      latitud: g.latitud ?? null,
      longitud: g.longitud ?? null,
      reglasAntifraude: g.reglasAntifraude ?? {},
      reglasDesconocidas: g.reglasDesconocidas ?? [],
    };
  }

  async updateCheckpointFraudRules(
    input: { id: string; fraudRules: CheckpointFraudRules | null },
    token: string
  ): Promise<void> {
    this.write('updateCheckpointFraudRules', input, token);
    this.checkpointGeo[input.id] = {
      ...this.checkpointGeo[input.id],
      reglasAntifraude: input.fraudRules ?? {},
    };
  }

  async moveCheckpoint(
    input: { id: string; latitude: number; longitude: number },
    token: string
  ): Promise<void> {
    this.write('moveCheckpoint', input, token);
    this.checkpointGeo[input.id] = {
      ...this.checkpointGeo[input.id],
      latitud: input.latitude,
      longitud: input.longitude,
    };
  }

  // Incidencias y Control de Acceso -----------------------------------------

  /** Detalle de cada incidencia por id; sin entrada = no existe (404 → null). */
  incidentDetails: Record<string, IncidentDetail> = {};
  /** Incidencias cuyo detalle se pidió, con la ubicación/organización de la query. */
  readonly incidentDetailCalls: IncidentTarget[] = [];

  async getIncidentDetail(target: IncidentTarget, token: string): Promise<IncidentDetail | null> {
    this.tokens.push(token);
    this.incidentDetailCalls.push(target);
    return this.incidentDetails[target.incidentId] ?? null;
  }

  /** Registros del Control de Acceso de todas las ubicaciones (se filtran como el backend). */
  accessLogs: AccessLogEntry[] = [];
  /** Lo que devuelve `listActiveAccessEntries` (filtrado por ubicación). */
  activeAccessEntries: AccessLogEntry[] = [];
  /** Error que lanzan las lecturas del Control de Acceso (p. ej. la App apagada). */
  accessLogsError: Error | null = null;
  readonly accessLogQueries: AccessLogQuery[] = [];

  async listAccessLogs(
    query: AccessLogQuery,
    token: string
  ): Promise<{ items: AccessLogEntry[]; total: number }> {
    this.tokens.push(token);
    this.accessLogQueries.push(query);
    if (this.accessLogsError) throw this.accessLogsError;
    const filtrados = this.accessLogs
      .filter(
        (a) =>
          a.locationId === query.locationId &&
          (!query.tipo || a.tipo === query.tipo) &&
          (!query.zona || a.zona === query.zona) &&
          (!query.desde || a.fecha >= query.desde) &&
          (!query.hasta || a.fecha <= query.hasta)
      )
      .sort((a, b) => b.fecha.localeCompare(a.fecha));
    const limit = Math.min(query.limit ?? 20, 100);
    const desde = ((query.page ?? 1) - 1) * limit;
    return { items: filtrados.slice(desde, desde + limit), total: filtrados.length };
  }

  async listActiveAccessEntries(
    locationId: string,
    token: string,
    zona?: string
  ): Promise<AccessLogEntry[]> {
    this.tokens.push(token);
    if (this.accessLogsError) throw this.accessLogsError;
    return this.activeAccessEntries.filter(
      (a) => a.locationId === locationId && (!zona || a.zona === zona)
    );
  }

  // Ubicaciones y usuarios del panel ----------------------------------------

  /** Lo que devuelve `inviteUser` (cuenta nueva con el correo enviado, por defecto). */
  inviteResult: InviteResult = { cuentaNueva: true, emailEnviado: true };

  async updateLocation(
    input: { id: string; name?: string; address?: string },
    token: string
  ): Promise<void> {
    this.write('updateLocation', input, token);
  }

  async deleteLocation(id: string, token: string): Promise<void> {
    this.write('deleteLocation', { id }, token);
  }

  async inviteUser(input: NewOrgUser, token: string): Promise<InviteResult> {
    this.write('inviteUser', input, token);
    return this.inviteResult;
  }

  /** Las dos escrituras de roles cambian `orgUsers`, como el backend: en un lote, la siguiente ve la lista nueva. */
  async updateUserRole(
    input: { userRoleId: string; roleType: 'VIEWER' | 'EDITOR' | 'ADMIN' },
    token: string
  ): Promise<void> {
    this.write('updateUserRole', input, token);
    this.orgUsers = this.orgUsers.map((u) => ({
      ...u,
      roles: u.roles.map((r) => (r.id === input.userRoleId ? { ...r, rol: input.roleType } : r)),
    }));
  }

  async deleteUserRole(userRoleId: string, token: string): Promise<void> {
    this.write('deleteUserRole', { userRoleId }, token);
    this.orgUsers = this.orgUsers.map((u) => ({
      ...u,
      roles: u.roles.filter((r) => r.id !== userRoleId),
    }));
  }
}
