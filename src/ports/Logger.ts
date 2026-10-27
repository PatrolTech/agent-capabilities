/**
 * Logger que las capacidades reciben por inyección: el paquete no sabe dónde se
 * escribe (JSON por consola en el bot, stderr en el servidor MCP…) ni depende de
 * ningún logger global.
 *
 * Convención: si el contexto trae un error, va en `meta.err`. El logger del bot
 * (`info(event, ctx)`) cumple esta interfaz tal cual.
 */
export interface Logger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

/** Logger que descarta todo: el valor por defecto cuando el consumidor no inyecta uno. */
export const noopLogger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};
