import { zonedParts } from './timezone.js';

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

/**
 * Escaneos como CSV que Excel abre bien sin dependencias: UTF-8 con BOM (sin él
 * Excel lee los acentos como Latin-1) y separador `;` (el de Excel en español y
 * en Latinoamérica, donde la coma es el separador decimal).
 */

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

// Inyección de fórmulas (OWASP «CSV injection»): una celda que empieza por uno
// de estos caracteres Excel la ejecuta como fórmula. El apóstrofo la deja en texto.
const FORMULA_RE = /^[=+\-@\t\r]/;

// Excel con `,` como separador de lista (configuración regional) parte la fila por comas
// aunque el fichero use `;`: una celda sin comillas como `Nave,=1+1` dejaría el fragmento
// tras la coma como celda nueva que empieza por `=` y se ejecutaría. Por eso también se
// entrecomilla toda celda con coma o tabulador.
const QUOTE_RE = /[";,\t\r\n]/;

/**
 * Una celda: texto neutralizado si parece fórmula y entre comillas si lleva `;`, `,`,
 * tabulador, comillas o saltos.
 */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (typeof value === 'string' && FORMULA_RE.test(text)) text = `'${text}`;
  return QUOTE_RE.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const dos = (n: number): string => String(n).padStart(2, '0');

/** `YYYY-MM-DD HH:mm:ss` en la hora del cliente: Excel lo reconoce como fecha en cualquier idioma. */
export function fechaLocal(iso: string, tz: string): string {
  const p = zonedParts(new Date(iso), tz);
  return `${p.y}-${dos(p.m)}-${dos(p.d)} ${dos(p.h)}:${dos(p.mi)}:${dos(p.s)}`;
}

function dispositivo(scan: ScanCsvRow): string {
  const { modelo, sistema } = scan.dispositivo ?? {};
  return [modelo, sistema].filter(Boolean).join(' · ');
}

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

type Celda = string | number | null | undefined;

/** Cabeceras y filas → el fichero. Lo comparten todos los Excel que envía el bot. */
export function csvBytes(
  cabeceras: readonly string[],
  filas: readonly (readonly Celda[])[]
): Buffer {
  const lineas = [cabeceras, ...filas].map((fila) => fila.map(csvCell).join(';'));
  return Buffer.from(`\uFEFF${lineas.join('\r\n')}\r\n`, 'utf8');
}
