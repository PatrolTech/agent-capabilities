import { zonedParts } from './timezone.js';

/**
 * El CSV que comparten todas las exportaciones, para que Excel lo abra bien sin
 * dependencias: UTF-8 con BOM (sin él Excel lee los acentos como Latin-1) y
 * separador `;` (el de Excel en español y en Latinoamérica, donde la coma es el
 * separador decimal).
 */

type Celda = string | number | null | undefined;

// Inyección de fórmulas (OWASP «CSV injection»). Se neutraliza toda celda de texto que:
// - empiece por tabulador o retorno de carro (OWASP los lista como peligrosos), o
// - empiece por `=`, `+`, `-` o `@`, también con espacios en blanco delante (espacio,
//   tabulador, CR, salto de línea, espacio duro o cualquier otro espacio Unicode): varias
//   hojas de cálculo recortan esos espacios al importar y evaluarían ` =1+1` como fórmula.
// El apóstrofo delante de la celda original la deja como texto.
// Solo se sanean las celdas de texto: un `number` sale de `String()` como dígitos con, a lo
// sumo, un `-` delante, así que un negativo legítimo (`-5`) no se toca y no puede llevar una
// fórmula. Un valor que llega como texto («+34 600», «-1») sí se neutraliza: puede escribirlo
// cualquiera.
const FORMULA_RE = /^(?:[\t\r]|\s*[=+\-@])/;

// Excel con `,` como separador de lista (configuración regional) parte la fila por comas
// aunque el fichero use `;`: una celda sin comillas como `Nave,=1+1` dejaría el fragmento
// tras la coma como celda nueva que empieza por `=` y se ejecutaría. Por eso también se
// entrecomilla toda celda con coma o tabulador.
const QUOTE_RE = /[";,\t\r\n]/;

/**
 * Una celda: texto neutralizado si parece fórmula y entre comillas si lleva `;`, `,`,
 * tabulador, comillas o saltos.
 */
export function csvCell(value: Celda): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (typeof value === 'string' && FORMULA_RE.test(text)) text = `'${text}`;
  return QUOTE_RE.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Cabeceras y filas → el fichero. Lo comparten todos los CSV que se exportan. */
export function csvBytes(
  cabeceras: readonly string[],
  filas: readonly (readonly Celda[])[]
): Buffer {
  const lineas = [cabeceras, ...filas].map((fila) => fila.map(csvCell).join(';'));
  return Buffer.from(`\uFEFF${lineas.join('\r\n')}\r\n`, 'utf8');
}

const dos = (n: number): string => String(n).padStart(2, '0');

/** `YYYY-MM-DD HH:mm:ss` en la hora del cliente: Excel lo reconoce como fecha en cualquier idioma. */
export function fechaLocal(iso: string, tz: string): string {
  const p = zonedParts(new Date(iso), tz);
  return `${p.y}-${dos(p.m)}-${dos(p.d)} ${dos(p.h)}:${dos(p.mi)}:${dos(p.s)}`;
}
