import { createApiClient, type SdkRequestInit } from '@patroltech/sdk-api';
import type { Logger } from '../../ports/Logger.js';
import { toPatrolTechApiError } from './errors.js';

/**
 * Lo que devuelve una función generada del SDK: la unión de sus respuestas por
 * status, cada una con su `data` (ya desenvuelto del envelope `ApiResponse`).
 * El SDK lanza en las no-2xx, así que aquí solo llegan las 2xx.
 */
export interface SdkResponse {
  data: unknown;
  status: number;
}

/** El `data` de las respuestas 2xx del tipo generado: lo único que puede llegar sin lanzar. */
export type SuccessData<R> = R extends { status: 200 | 201 | 202 | 203 | 204 | 206; data: infer D }
  ? D
  : never;

/**
 * Lo que devuelve una función generada del SDK además de `data`: el resto de campos
 * del envelope (`message`, `meta`…), que el OpenAPI no describe.
 */
export interface SdkEnvelopeExtras {
  meta?: unknown;
  message?: unknown;
  [field: string]: unknown;
}

/** Una llamada a una función generada del SDK con las opciones de esta petición. */
export type SdkCall<R extends SdkResponse = SdkResponse> = (init: SdkRequestInit) => Promise<R>;

export interface SdkTransportConfig {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  timeoutMs: number;
  logger: Logger;
  /** Cabeceras que se suman a cada petición; se piden en cada una (id de petición, cliente…). */
  defaultHeaders?: () => Record<string, string>;
}

/**
 * La identidad de la petición la pone el token, nunca las cabeceras por defecto:
 * se descarta cualquier `Authorization`, con la grafía que sea (si no, con otra
 * mayúscula irían las dos y el servidor las uniría, o saldría una sin token).
 */
function sinAuthorization(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).filter(([name]) => !/^authorization$/i.test(name))
  );
}

/** Configuración de `callSdk`: la misma para todos los usuarios (el token va en cada llamada). */
export type SdkCallConfig = Pick<
  SdkTransportConfig,
  'baseUrl' | 'fetchImpl' | 'timeoutMs' | 'defaultHeaders'
>;

/**
 * Una llamada a una función generada del SDK con su propia configuración (base, token, `fetch`,
 * cabeceras sin `Authorization` y timeout): nada global. Un rechazo del backend sale como
 * `PatrolTechApiError` (status, `path` y cuerpo), que entiende `translateBackendError`; un fallo
 * de red o timeout, tal cual. Es lo que usa `SdkTransport` y lo que reutilizan los consumidores
 * que llaman a operaciones del SDK fuera del gateway (el MCP: propuestas, directorio, hoja de QR).
 * El timeout evita que una llamada colgada bloquee a quien procesa en serie.
 */
export async function callSdk<R>(
  config: SdkCallConfig,
  token: string | null,
  path: string,
  call: (init: SdkRequestInit) => Promise<R>
): Promise<R> {
  const { baseUrl, fetchImpl, timeoutMs, defaultHeaders } = config;
  const client = createApiClient({
    baseUrl,
    fetchImpl,
    defaultHeaders: defaultHeaders && (() => sinAuthorization(defaultHeaders())),
    getAccessToken: () => token,
  });
  try {
    return await call(client.init({ signal: AbortSignal.timeout(timeoutMs) }));
  } catch (err) {
    throw toPatrolTechApiError(err, path);
  }
}

/**
 * Único punto por el que pasan las llamadas al backend: cada una con su propia
 * configuración del SDK (base, token, `fetch`; nada global, así un servidor
 * multi-tenant no mezcla identidades), con timeout y con los errores traducidos
 * a `PatrolTechApiError`.
 */
export class SdkTransport {
  constructor(private readonly config: SdkTransportConfig) {}

  get logger(): Logger {
    return this.config.logger;
  }

  /**
   * La respuesta entera (status, `data` y los demás campos del envelope).
   * `token` null = endpoint público (sin cabecera `Authorization`). `path` solo
   * nombra la ruta en el error.
   */
  async envelope<R extends SdkResponse>(
    token: string | null,
    path: string,
    call: SdkCall<R>
  ): Promise<R & SdkEnvelopeExtras> {
    // El SDK devuelve, además de lo tipado, el resto del envelope (`message`, `meta`…).
    return (await callSdk(this.config, token, path, call)) as R & SdkEnvelopeExtras;
  }

  /**
   * El payload (`data`) de la respuesta, con el tipo que el SDK genera del
   * OpenAPI para su respuesta 2xx: sin genérico a mano ni cast.
   */
  async data<R extends SdkResponse>(
    token: string | null,
    path: string,
    call: SdkCall<R>
  ): Promise<SuccessData<R>> {
    return (await this.envelope(token, path, call)).data as SuccessData<R>;
  }
}
