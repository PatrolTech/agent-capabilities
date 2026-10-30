import { csvBytes, fechaLocal } from './csv.js';

/**
 * Lo que el CSV necesita de un escaneo reciente. Es un subconjunto estructural
 * del escaneo que devuelve el backend: cualquier `RecentScan` lo cumple, y este
 * módulo no depende de la forma completa del cliente.
 */
export interface ScanCsvRow {
  timestamp: string;
  checkpointName: string | null;
  patrollerName: string | null;
  fraudFlagged: boolean;
  /** Estado de validación en lenguaje de cliente. */
  validacion: string;
  /** Motivos reales de la sospecha; vacío si no es sospechoso. */
  motivosSospecha: string[];
  dispositivo?: { modelo?: string; sistema?: string; bateriaPct?: number };
  distanciaGpsM?: number;
}

const CABECERAS = [
  'Fecha y hora',
  'Vigilante',
  'Checkpoint',
  'Ubicación',
  'Validación',
  'Sospechoso',
  'Distancia GPS (m)',
  'Dispositivo',
  'Batería %',
];

function dispositivo(scan: ScanCsvRow): string {
  const { modelo, sistema } = scan.dispositivo ?? {};
  return [modelo, sistema].filter(Boolean).join(' · ');
}

/** Escaneos como CSV para Excel (formato y saneado en `csv.ts`). */
export function scansCsv(
  scans: readonly ScanCsvRow[],
  opts: { tz: string; ubicacionDe: (scan: ScanCsvRow) => string }
): Buffer {
  const filas = scans.map((s) => [
    fechaLocal(s.timestamp, opts.tz),
    s.patrollerName,
    s.checkpointName,
    opts.ubicacionDe(s),
    s.validacion,
    s.fraudFlagged ? `sí: ${s.motivosSospecha.join('; ')}` : 'no',
    s.distanciaGpsM,
    dispositivo(s),
    s.dispositivo?.bateriaPct,
  ]);
  return csvBytes(CABECERAS, filas);
}
