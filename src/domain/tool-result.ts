import { noopLogger, type Logger } from '../ports/Logger.js';
import {
  PatrolTechApiError,
  translateBackendError,
  type TranslateErrorOptions,
} from './backend-errors.js';
import type { FixedTextLanguage } from './language.js';

/**
 * Contrato único de retorno de las tools del LLM.
 *
 * Todas las tools devuelven esta forma: el modelo no tiene que adivinar si
 * `{found:false}`, `{error}` o un array vacío significan "no hay datos", "no se
 * entendió la pregunta" o "el backend falló". Además, `truncado` le avisa de que
 * los datos están capados (no puede afirmar totales ni ausencias) y `avisos`
 * lleva el detalle en lenguaje natural.
 */
export type ToolResult<T> =
  | { ok: true; data: T; truncado?: boolean; avisos?: string[] }
  | { ok: false; error: string; opciones?: string[] };

/** Resultado correcto. `truncado`/`avisos` solo viajan si aportan algo. */
export function ok<T>(data: T, extra?: { truncado?: boolean; avisos?: string[] }): ToolResult<T> {
  const avisos = extra?.avisos?.filter((a) => a.length > 0) ?? [];
  return {
    ok: true,
    data,
    ...(extra?.truncado ? { truncado: true } : {}),
    ...(avisos.length > 0 ? { avisos } : {}),
  };
}

/** Resultado fallido. `opciones` es la lista para desambiguar, cuando la hay. */
export function fail(error: string, opciones?: string[]): ToolResult<never> {
  return { ok: false, error, ...(opciones && opciones.length > 0 ? { opciones } : {}) };
}

/**
 * Opciones de `safeExecute`: el `logger` donde se registra el fallo (por defecto,
 * uno nulo), el idioma del cliente en el que se explica (por defecto, español) y
 * la política de textos (`urls`, `upsell`, `operation`).
 */
export interface SafeExecuteOptions extends TranslateErrorOptions {
  logger?: Logger;
  language?: FixedTextLanguage;
}

/**
 * Ejecuta el cuerpo de una tool capturando cualquier error.
 *
 * Un throw dentro de la herramienta (con `ai` v6, dentro de `execute`) aborta el
 * turno entero: el cliente recibe el fallback y se abre un escalado espurio. Aquí el
 * error se convierte en `{ok:false,error}`, que el modelo sí puede leer y
 * contarle al usuario (o reintentar con otros parámetros).
 *
 * Al modelo nunca le llega `err.message` (rutas, ids, textos internos): un
 * rechazo del backend (`PatrolTechApiError`) va traducido con
 * `translateBackendError` en el idioma del cliente (sesión caducada, permiso,
 * límite, suspensión, 404…) y cualquier otro fallo (red, timeout, error de
 * programación) con el texto genérico de «el panel no responde». El detalle
 * queda en el `logger`.
 */
export async function safeExecute<T>(
  nombre: string,
  fn: () => Promise<ToolResult<T>>,
  { logger = noopLogger, language = 'es', ...policy }: SafeExecuteOptions = {}
): Promise<ToolResult<T>> {
  try {
    return await fn();
  } catch (err) {
    const failure = translateBackendError(err, language, policy);
    logger.error('tool.execute_failed', {
      tool: nombre,
      kind: failure.kind,
      ...(err instanceof PatrolTechApiError ? { status: err.status, path: err.path } : {}),
      err,
    });
    return fail(failure.mensajeCliente);
  }
}
