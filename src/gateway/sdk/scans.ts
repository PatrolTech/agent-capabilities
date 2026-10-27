import {
  getListScansUrl,
  listScans,
  type ListScansParams,
  type ScanListItem,
  type ScanListItemDeviceInfo,
} from '@patroltech/sdk-api';
import { explainScan } from '../../domain/scan-explanation.js';
import type { ListaTruncable, RecentScan, ScanDevice, ScanQuery } from '../types/index.js';
import { isTruncated } from './list.js';
import type { SdkTransport } from './transport.js';

const DEFAULT_SCANS_LIMIT = 10;

/** Solo los datos del móvil que vienen; undefined si no hay ninguno. */
function scanDevice(d: ScanListItemDeviceInfo | undefined): ScanDevice | undefined {
  if (!d) return undefined;
  const modelo = [d.manufacturer, d.deviceName].filter((x): x is string => !!x).join(' ');
  const sistema = [d.platform, d.osVersion].filter((x): x is string => !!x).join(' ');
  const device: ScanDevice = {
    ...(modelo ? { modelo } : {}),
    ...(sistema ? { sistema } : {}),
    ...(typeof d.batteryLevel === 'number' ? { bateriaPct: Math.round(d.batteryLevel) } : {}),
    ...(d.batteryStatus ? { cargando: d.batteryStatus === 'charging' } : {}),
    ...(d.connectionType ? { conexion: d.connectionType } : {}),
  };
  return Object.keys(device).length > 0 ? device : undefined;
}

function toRecentScan(s: ScanListItem): RecentScan {
  const base = {
    timestamp: s.timestamp,
    checkpointName: s.checkpointName ?? null,
    patrollerName: s.patrollerName ?? null,
  };
  // Fuera del historial del plan el backend oculta el detalle: no hay nada que explicar.
  if (s.redacted === true) {
    return {
      ...base,
      fraudFlagged: false,
      validacion: 'oculto por la retención de datos',
      motivosSospecha: [],
    };
  }
  const dispositivo = scanDevice(s.deviceInfo);
  const gps = s.fraudFlags?.gpsProximity;
  return {
    ...base,
    fraudFlagged: s.fraudFlags?.flagged === true,
    ...explainScan({
      validationStatus: s.validationStatus ?? null,
      validationReason: s.validationReason ?? null,
      fraudFlags: s.fraudFlags ?? null,
    }),
    ...(dispositivo ? { dispositivo } : {}),
    ...(typeof gps?.distanceMeters === 'number'
      ? { distanciaGpsM: Math.round(gps.distanceMeters) }
      : {}),
    ...(typeof gps?.accuracyMeters === 'number'
      ? { precisionGpsM: Math.round(gps.accuracyMeters) }
      : {}),
  };
}

export async function getRecentScans(
  t: SdkTransport,
  accountId: string,
  token: string,
  opts?: ScanQuery
): Promise<ListaTruncable<RecentScan>> {
  // Mismo orden de parámetros que siempre; solo los que vienen.
  const params: ListScansParams = {
    organizationId: accountId,
    limit: opts?.limit || DEFAULT_SCANS_LIMIT,
    ...(opts?.page ? { page: opts.page } : {}),
    ...(opts?.dateFrom ? { dateFrom: opts.dateFrom } : {}),
    ...(opts?.dateTo ? { dateTo: opts.dateTo } : {}),
    ...(opts?.patrollerId ? { patroller: opts.patrollerId } : {}),
    ...(opts?.checkpointId ? { checkpoint: opts.checkpointId } : {}),
    ...(opts?.locationId ? { locationId: opts.locationId } : {}),
    ...(opts?.soloSospechosos ? { fraudStatus: 'flagged' as const } : {}),
    ...(opts?.soloNoValidos ? { validationStatus: 'rejected' as const } : {}),
  };
  const body = await t.data(token, getListScansUrl(params), (init) => listScans(params, init));
  const items = body.results.map(toRecentScan);
  return { items, total: body.count, truncado: isTruncated(body, items.length) };
}
