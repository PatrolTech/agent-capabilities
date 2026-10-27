/** Acciones de escritura que se pueden hacer por el cliente (siempre con su confirmación). */
export const BOT_ACTIONS = [
  'create_checkpoint',
  'create_patroller',
  'set_alert_preference',
  'create_route',
  'add_time_window',
  'delete_time_window',
  'set_route_active',
  'route_checkpoint',
  'incident_update',
  'rename_patroller',
  'edit_checkpoint',
  'archive_checkpoint',
  'edit_checkpoint_antifraud',
  'move_checkpoint',
  'edit_location',
  'delete_location',
  'invite_user',
  'change_user_role',
  'remove_user_access',
] as const;

export type BotActionName = (typeof BOT_ACTIONS)[number];

/** La parte de la config que decide qué acciones están activas y para quién (misma forma que la `Config` del bot). */
export interface BotActionFlags {
  botActionsEnabled: readonly BotActionName[];
  /** Identificadores del contacto ya normalizados (en el bot, `normalizeWaId`); vacía = todos. */
  botActionsAllowlist: readonly string[];
}

/**
 * ¿Puede este contacto usar esta acción? Con `botActionsEnabled` vacío, nunca:
 * el consumidor se comporta exactamente como sin acciones. `externalId` llega ya
 * normalizado (el adaptador de WhatsApp del bot lo pasa por `normalizeWaId` al recibir).
 */
export function isActionEnabled(
  flags: BotActionFlags,
  action: BotActionName,
  externalId: string
): boolean {
  if (!flags.botActionsEnabled.includes(action)) return false;
  return flags.botActionsAllowlist.length === 0 || flags.botActionsAllowlist.includes(externalId);
}

/**
 * Una acción que, al confirmarse, la propia acción decide NO hacer (una protección
 * que ya no se cumple con los datos del momento: el último Admin, uno mismo, el
 * checkpoint que ya no está…). No es un fallo del backend: `ejecutar` la lanza
 * con el texto al cliente ya en su idioma y el motor la guarda como `failed`,
 * sin aviso de «hecha» al equipo.
 */
export class AccionRechazada extends Error {
  constructor(readonly mensajeCliente: string) {
    super(mensajeCliente);
    this.name = 'AccionRechazada';
  }
}
