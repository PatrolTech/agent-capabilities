import { parseLocalDate } from '../../domain/date-range.js';
import { fail, type ToolResult } from '../../domain/tool-result.js';
import type { FileSink } from '../../ports/FileSink.js';
import { DIA_MS } from './scans.js';

/** Lo común de los Excel que se envían: el periodo admitido y cómo sale el fichero. */

const MAX_DIAS = 31;

/** Comprueba el periodo de un Excel (fechas YYYY-MM-DD, en orden y de 31 días como mucho); null si vale. */
export function validarPeriodoExcel(desdeYmd: string, hastaYmd: string): ToolResult<never> | null {
  const desde = parseLocalDate(desdeYmd);
  const hasta = parseLocalDate(hastaYmd);
  if (!desde || !hasta) return fail('Fechas no válidas: usa YYYY-MM-DD en «desde» y «hasta».');
  const dias =
    (Date.UTC(hasta.y, hasta.m - 1, hasta.d) - Date.UTC(desde.y, desde.m - 1, desde.d)) / DIA_MS +
    1;
  if (dias < 1) return fail('«desde» es posterior a «hasta»: corrige las fechas.');
  if (dias > MAX_DIAS) {
    return fail(`El periodo máximo es de ${MAX_DIAS} días: pídelo por meses o acota las fechas.`);
  }
  return null;
}

/**
 * Envía un CSV como documento que se abre con Excel. Va declarado como lo que es
 * (`text/csv`): el adaptador de cada canal lo cambia si su plataforma no lo admite.
 */
export async function enviarCsv(
  files: FileSink,
  bytes: Uint8Array,
  filename: string,
  caption: string
): Promise<void> {
  await files.sendDocument({
    bytes,
    filename,
    // Un canal que no admita `text/csv` puede subirlo como `application/vnd.ms-excel` (el nombre
    // sigue siendo .csv).
    mimeType: 'text/csv',
    caption,
  });
}
