/** Móvil con el que se hizo un escaneo, tal como lo informa la app. Sin los campos que no vienen. */
export interface ScanDevice {
  modelo?: string;
  sistema?: string;
  /** Porcentaje 0-100 (el backend ya lo multiplica por 100). */
  bateriaPct?: number;
  cargando?: boolean;
  conexion?: string;
}

export interface RecentScan {
  timestamp: string;
  checkpointName: string | null;
  patrollerName: string | null;
  fraudFlagged: boolean;
  /** Estado de validación en lenguaje de cliente, con su motivo real (ver domain/scan-explanation). */
  validacion: string;
  /** Motivos reales de la sospecha; vacío si no es sospechoso. */
  motivosSospecha: string[];
  dispositivo?: ScanDevice;
  /** Distancia del móvil al punto según la regla de proximidad GPS, si se evaluó. */
  distanciaGpsM?: number;
  /** Precisión del GPS del móvil en ese escaneo, si se evaluó la proximidad. */
  precisionGpsM?: number;
}

/**
 * Filtros de `GET /api/scans`. `patrollerId`/`checkpointId`/`locationId` son
 * ids ya resueltos (el backend no filtra por nombre).
 */
export interface ScanQuery {
  /** Máximo 100 (el backend rechaza más). */
  limit?: number;
  /** Página 1-based de `limit` escaneos. */
  page?: number;
  dateFrom?: string;
  dateTo?: string;
  patrollerId?: string;
  checkpointId?: string;
  locationId?: string;
  /** `fraudStatus=flagged`. */
  soloSospechosos?: boolean;
  /** `validationStatus=rejected` (lo que el panel marca como no válido). */
  soloNoValidos?: boolean;
}
