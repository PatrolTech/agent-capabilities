import { describe, it, expect } from 'vitest';
import { accessLogsCsv, type AccessLogCsvRow } from './access-logs-csv.js';

const registro = (over: Partial<AccessLogCsvRow> = {}): AccessLogCsvRow => ({
  fecha: '2026-07-29T08:00:00Z',
  tipo: 'ENTRY',
  zona: null,
  persona: null,
  identificadorPersona: null,
  visitante: null,
  documentoVisitante: null,
  empresaVisitante: null,
  destino: null,
  notas: null,
  ...over,
});

const opts = { tz: 'Europe/Madrid', ubicacionDe: () => 'Sede' };

/** Las celdas de la primera fila de datos, sin la cabecera ni el BOM. */
const primeraFila = (rows: AccessLogCsvRow[]): string =>
  new TextDecoder().decode(accessLogsCsv(rows, opts)).split('\r\n')[1];

describe('accessLogsCsv', () => {
  it('emite BOM UTF-8, cabecera con ; y el tipo en español', () => {
    const bytes = accessLogsCsv([registro()], opts);
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const texto = bytes.toString('utf8');
    expect(texto).toContain('Fecha y hora;Tipo;Ubicación;Zona;');
    expect(primeraFila([registro({ tipo: 'EXIT' })])).toContain(';Salida;Sede;');
  });

  // Corrección respecto al bot: el valor lo teclea el visitante o el portero, así que no es de fiar.
  it('un valor con coma sale como una sola celda: «Nave,=1+1» no deja una fórmula suelta', () => {
    expect(primeraFila([registro({ destino: 'Nave,=1+1' })])).toContain(';"Nave,=1+1";');
  });

  it('sigue neutralizando el inicio de fórmula (=, +, -, @)', () => {
    for (const valor of ['=1+1', '+1', '-1', '@SUM(A1)']) {
      expect(primeraFila([registro({ visitante: valor })])).toContain(`;'${valor};`);
    }
  });

  it('un valor sin caracteres especiales no se entrecomilla', () => {
    const fila = primeraFila([registro({ visitante: 'Ana López', empresaVisitante: 'ACME' })]);
    expect(fila).toContain(';Ana López;');
    expect(fila).toContain(';ACME;');
    expect(fila).not.toContain('"');
  });

  // Portado del bot (test/tools/account-tools-lote-b-corner-cases): inyección y celdas raras a la vez.
  it('neutraliza = + - @ al principio y entrecomilla ; comillas y saltos de línea', () => {
    const csv = accessLogsCsv(
      [
        registro({
          fecha: '2026-10-10T07:00:00.000Z',
          visitante: '=HYPERLINK("http://evil","x")',
          documentoVisitante: '+34600111222',
          empresaVisitante: '@SUM(A1)',
          destino: '-1',
          notas: 'Llegó tarde; dijo "hola"\nsalió',
          zona: 'Portería',
        }),
      ],
      { tz: 'America/Mexico_City', ubicacionDe: () => 'Sede; Central' }
    ).toString('utf8');
    const fila = csv.split('\r\n')[1];
    expect(fila.startsWith('2026-10-10 01:00:00;Entrada;"Sede; Central";Portería;;;')).toBe(true);
    expect(fila).toContain(`"'=HYPERLINK(""http://evil"",""x"")"`);
    expect(fila).toContain(";'+34600111222;'@SUM(A1);'-1;");
    expect(csv).toContain('"Llegó tarde; dijo ""hola""\nsalió"');
  });
});
