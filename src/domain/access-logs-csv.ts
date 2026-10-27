import { csvBytes, fechaLocal } from './scans-csv.js';

/**
 * Lo que el CSV necesita de un registro de acceso: subconjunto estructural del
 * registro que devuelve el backend (cualquier `AccessLogEntry` lo cumple).
 */
export interface AccessLogCsvRow {
  fecha: string;
  tipo: 'ENTRY' | 'EXIT';
  zona: string | null;
  persona: string | null;
  identificadorPersona: string | null;
  visitante: string | null;
  documentoVisitante: string | null;
  empresaVisitante: string | null;
  destino: string | null;
  notas: string | null;
}

/**
 * Registros del Control de Acceso como CSV para Excel, con las mismas columnas
 * que la tabla del panel. Aquí SÍ va el documento del visitante: es lo mismo que
 * ve en el panel; lo que no se hace es escribirlo en el texto del chat.
 */

const CABECERAS = [
  'Fecha y hora',
  'Tipo',
  'Ubicación',
  'Zona',
  'Persona autorizada',
  'Identificador',
  'Visitante',
  'Documento',
  'Empresa',
  'Destino',
  'Notas',
];

export const TIPO_ACCESO = { ENTRY: 'Entrada', EXIT: 'Salida' } as const;

export function accessLogsCsv<R extends AccessLogCsvRow>(
  registros: readonly R[],
  opts: { tz: string; ubicacionDe: (registro: R) => string }
): Buffer {
  return csvBytes(
    CABECERAS,
    registros.map((a) => [
      fechaLocal(a.fecha, opts.tz),
      TIPO_ACCESO[a.tipo],
      opts.ubicacionDe(a),
      a.zona,
      a.persona,
      a.identificadorPersona,
      a.visitante,
      a.documentoVisitante,
      a.empresaVisitante,
      a.destino,
      a.notas,
    ])
  );
}
