import { fail, ok, type ToolResult } from '../../domain/tool-result.js';
import type { ListaTruncable } from '../../gateway/index.js';

/** Coletilla de las descripciones de las capacidades que devuelven listas capadas. */
export const TRUNCADO_HINT =
  ' Si el resultado trae `truncado: true`, los datos están CAPADOS: no afirmes totales ni ausencias ("no se ha escaneado nunca", "solo hay N"); dilo y acota el periodo.';

/** Opciones como mucho en una pregunta de desambiguación. */
export const MAX_OPCIONES = 15;

/** ¿Es un fallo ya listo para devolver (y no el valor resuelto)? */
export function isFail<T extends object>(x: T | ToolResult<never>): x is ToolResult<never> {
  return 'ok' in x;
}

/**
 * Mismo contrato para TODA ambigüedad (organización, vigilante, ruta): el modelo
 * no tiene que aprenderse un `found:false`/`ambigua` distinto por capacidad.
 */
export function failAmbigua(valor: string, queSon: string, opciones: string[]): ToolResult<never> {
  return fail(
    `ambigua: «${valor}» coincide con varios/as ${queSon}; pregunta al usuario cuál de estas quiere`,
    opciones
  );
}

/** Lo mismo cuando no hay ninguna coincidencia. */
export function failNoEncontrado(queSon: string, opciones?: string[]): ToolResult<never> {
  return fail(`no encontrado: no hay ningún/a ${queSon} con ese nombre`, opciones);
}

/** Texto del aviso de truncado, compartido por las listas y por el ranking. */
export function avisoTruncado(
  devueltos: number,
  total: number | undefined,
  queSon: string
): string {
  const deTotal = typeof total === 'number' ? ` de ${total}` : '';
  return `Resultado TRUNCADO: se devuelven ${devueltos}${deTotal} ${queSon}. No afirmes totales ni ausencias; acota el periodo o el filtro.`;
}

/** Envuelve una lista posiblemente capada, avisando al modelo de que hay más datos. */
export function okLista<T>(
  lista: ListaTruncable<T>,
  queSon: string,
  avisosExtra: string[] = []
): ToolResult<T[]> {
  const avisos = [...avisosExtra];
  if (lista.truncado) avisos.push(avisoTruncado(lista.items.length, lista.total, queSon));
  return ok(lista.items, { truncado: lista.truncado, avisos });
}

/** Aviso cuando alguna ubicación no se pudo leer: sus checkpoints faltan de la lista. */
export function avisosUbicaciones(ubicacionesConError: number): string[] {
  return ubicacionesConError > 0
    ? [
        `${ubicacionesConError} ubicación(es) no se pudieron consultar: faltan sus checkpoints. NO afirmes que un checkpoint no existe o no se ha escaneado.`,
      ]
    : [];
}
