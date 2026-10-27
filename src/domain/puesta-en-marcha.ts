/**
 * Las cuatro lecturas del backend que hacen falta para saber en qué punto de la
 * puesta en marcha está una organización. Es un puerto mínimo: cualquier cliente
 * del backend que las ofrezca (el `PatrolTechClient` del bot, el gateway) lo cumple.
 */
export interface PuestaEnMarchaSource {
  getSupportSummary(
    orgId: string,
    token: string
  ): Promise<{ checkpoints: { total: number }; patrollers: { total: number } }>;
  listPatrollers(orgId: string, token: string): Promise<{ items: { lastScanAt: string | null }[] }>;
  listRoutes(orgId: string, token: string): Promise<{ items: unknown[] }>;
  getRecentScans(
    orgId: string,
    token: string,
    opts: { limit: number }
  ): Promise<{ items: { timestamp: string }[] }>;
}

/** Hitos de la puesta en marcha de una organización, tal como los da el backend. */
export interface PuestaEnMarcha {
  checkpointsCreados: number;
  vigilantes: number;
  /** Vigilantes con algún escaneo: señal de que ya usan la app. */
  vigilantesConAlgunEscaneo: number;
  hayEscaneos: boolean;
  ultimoEscaneo: string | null;
  rutasCreadas: number;
}

/**
 * Consulta al backend en qué punto de la puesta en marcha está la organización.
 * La usan `consultar_puesta_en_marcha`, el siguiente paso tras cada acción y el
 * nudge: los tres deciden con el mismo estado real. Lanza si el backend falla.
 */
export async function leerPuestaEnMarcha(
  patrolTech: PuestaEnMarchaSource,
  orgId: string,
  token: string
): Promise<PuestaEnMarcha> {
  const [resumen, vigilantes, rutas, escaneos] = await Promise.all([
    patrolTech.getSupportSummary(orgId, token),
    patrolTech.listPatrollers(orgId, token),
    patrolTech.listRoutes(orgId, token),
    patrolTech.getRecentScans(orgId, token, { limit: 1 }),
  ]);
  return {
    checkpointsCreados: resumen.checkpoints.total,
    vigilantes: resumen.patrollers.total,
    vigilantesConAlgunEscaneo: vigilantes.items.filter((p) => p.lastScanAt).length,
    hayEscaneos: escaneos.items.length > 0,
    ultimoEscaneo: escaneos.items[0]?.timestamp ?? null,
    rutasCreadas: rutas.items.length,
  };
}
