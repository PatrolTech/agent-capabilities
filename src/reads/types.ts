import type { z } from 'zod';
import type { SessionContext } from '../context.js';
import type { ToolResult } from '../domain/tool-result.js';
import type { FileSink } from '../ports/FileSink.js';
import type { CapabilityDeps, CapabilityEnv } from '../deps.js';

/**
 * El contexto de una lectura: el de la sesión (`SessionContext`) y, si el canal
 * puede entregarlos, dónde dejar los ficheros. La organización la resuelve el
 * consumidor con `resolveOrganization`, solo entre `organizations`; el
 * envoltorio de `readCapabilities` comprueba que sea una de ellas y usa SU
 * entrada (rol y ámbito de la sesión).
 */
export interface CapabilityContext extends SessionContext {
  /**
   * Dónde dejar el QR y los Excel de ESTA llamada (la conversación o la sesión
   * del usuario). Va en el contexto y no en las dependencias: un `FileSink`
   * compartido entre usuarios mandaría los ficheros de uno a otro.
   */
  files?: FileSink;
}

/**
 * Una capacidad de lectura. `params` son sus parámetros PROPIOS: el de la
 * organización no aparece nunca aquí (lo añade el consumidor solo si el usuario
 * tiene más de una y lo resuelve con `resolveOrganization`).
 */
export interface ReadCapability<P extends z.ZodRawShape = z.ZodRawShape> {
  /** Nombre de la herramienta (el del bot, p. ej. `consultar_estado_rondas`). */
  name: string;
  description: string;
  params: P;
  call(ctx: CapabilityContext, args: z.infer<z.ZodObject<P>>): Promise<ToolResult<unknown>>;
}

/** Declara una capacidad conservando la inferencia de `params` en `call`. */
export function defineRead<P extends z.ZodRawShape>(read: ReadCapability<P>): ReadCapability {
  return read;
}

/** Dependencias de `readCapabilities`: las comunes y si el canal entrega ficheros. */
export interface ReadDeps extends CapabilityDeps {
  /**
   * true = el canal puede entregar ficheros: existen `enviar_qr_checkpoint` y
   * los dos `enviar_excel_*`, que los dejan en `ctx.files` de cada llamada. Por
   * defecto, false (no se ofrecen).
   */
  offerFiles?: boolean;
}

/** Las dependencias ya con sus valores por defecto, tal como las reciben las áreas. */
export interface ReadEnv extends CapabilityEnv {
  offerFiles: boolean;
}
