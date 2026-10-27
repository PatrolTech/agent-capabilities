import { z } from 'zod';
import { segunIdioma, type FixedTextLanguage } from '../domain/language.js';
import {
  ALERT_CHANNELS,
  ALERT_TYPES,
  type AlertChannel,
  type AlertType,
} from '../gateway/index.js';
import { defineBotAction, type ActionDefinition, type ActionEnv } from './types.js';

/** Activar o desactivar una alerta del propio usuario. */

/** Nombre de cada alerta tal como sale en «Preferencias de notificaciones» del panel. */
const ALERT_LABELS: Record<AlertType, Record<FixedTextLanguage, string>> = {
  pending_route: { es: 'Ruta pendiente', en: 'Pending route', fr: 'Parcours en attente' },
  missed_route: { es: 'Ruta no completada', en: 'Missed route', fr: 'Parcours non effectué' },
  upcoming_deadline: { es: 'Fecha límite próxima', en: 'Upcoming deadline', fr: 'Échéance proche' },
  patroller_inactive: { es: 'Patrullero inactivo', en: 'Inactive patroller', fr: 'Agent inactif' },
  suspicious_scan: { es: 'Escaneo sospechoso', en: 'Suspicious scan', fr: 'Scan suspect' },
  role_assignment: { es: 'Asignación de rol', en: 'Role assignment', fr: 'Attribution de rôle' },
  incident_created: { es: 'Nueva incidencia', en: 'New incident', fr: 'Nouvel incident' },
  incident_status_changed: {
    es: 'Estado de incidencia cambiado',
    en: 'Incident status changed',
    fr: "Statut d'incident modifié",
  },
  incident_assigned: { es: 'Incidencia asignada', en: 'Incident assigned', fr: 'Incident assigné' },
  incident_comment: {
    es: 'Comentario en incidencia',
    en: 'Incident comment',
    fr: 'Commentaire sur un incident',
  },
};
const CHANNEL_LABELS: Record<AlertChannel, string> = {
  email: 'email',
  push: 'push',
  whatsapp: 'WhatsApp',
};
/** Tipos sin canal WhatsApp en el registro de alertas del backend (`availableChannels`). */
const SIN_WHATSAPP: readonly AlertType[] = ['incident_assigned', 'incident_comment'];

const alertParams = {
  tipo: z
    .enum(ALERT_TYPES)
    .describe(
      'Tipo de alerta: pending_route = Ruta pendiente; missed_route = Ruta no completada; upcoming_deadline = Fecha límite próxima; ' +
        'patroller_inactive = Patrullero inactivo; suspicious_scan = Escaneo sospechoso; role_assignment = Asignación de rol; ' +
        'incident_created = Nueva incidencia; incident_status_changed = Estado de incidencia cambiado; incident_assigned = Incidencia asignada; ' +
        'incident_comment = Comentario en incidencia'
    ),
  canal: z.enum(ALERT_CHANNELS).describe('Canal: email, push o whatsapp'),
  activar: z
    .boolean()
    .describe('true = empezar a recibirla por ese canal; false = dejar de recibirla'),
};

export function setAlertPreference({ gateway }: ActionEnv): ActionDefinition {
  return defineBotAction({
    nombre: 'set_alert_preference',
    tool: 'proponer_cambiar_alerta',
    descripcion:
      'Prepara activar o desactivar UNA alerta del propio usuario por un canal (email, push o WhatsApp). Solo cambia sus avisos, ' +
      'no los de otros usuarios. NO lo cambia: le envía un resumen con un botón para confirmarlo. Úsala cuando el cliente quiera ' +
      'dejar de recibir o empezar a recibir un aviso. Para varios cambios, llámala una vez por cada uno en el MISMO turno: van juntos en una sola confirmación. ' +
      'Por WhatsApp solo llegan de verdad Ruta no completada, Patrullero inactivo y Escaneo sospechoso.',
    params: alertParams,
    rolMinimo: 'VIEWER',
    async preparar(_ctx, p) {
      if (p.canal === 'whatsapp' && SIN_WHATSAPP.includes(p.tipo)) {
        return {
          error: `La alerta «${ALERT_LABELS[p.tipo].es}» no tiene canal WhatsApp: solo email y push.`,
        };
      }
      return { params: p };
    },
    resumen(p, { idioma }) {
      const alerta = ALERT_LABELS[p.tipo][idioma];
      const canal = CHANNEL_LABELS[p.canal];
      return segunIdioma(idioma, {
        es:
          `${p.activar ? 'Activar' : 'Desactivar'} la alerta «${alerta}» por ${canal} para tu usuario. ` +
          'Solo te afecta a ti, en todas tus organizaciones; no cambia los avisos de nadie más.',
        en:
          `${p.activar ? 'Turn on' : 'Turn off'} the «${alerta}» alert by ${canal} for your user. ` +
          'It only affects you, in all your organizations; nobody else’s notices change.',
        fr:
          `${p.activar ? 'Activer' : 'Désactiver'} l'alerte «${alerta}» par ${canal} pour votre utilisateur. ` +
          'Cela ne concerne que vous, dans toutes vos organisations ; les avis des autres ne changent pas.',
      });
    },
    async ejecutar(ctx, p) {
      await gateway.setAlertPreference(
        { tipo: p.tipo, canal: p.canal, activar: p.activar },
        ctx.token
      );
      const alerta = ALERT_LABELS[p.tipo][ctx.language];
      const canal = CHANNEL_LABELS[p.canal];
      return {
        texto: segunIdioma(ctx.language, {
          es: `✅ Hecho: la alerta «${alerta}» por ${canal} queda ${p.activar ? 'activada' : 'desactivada'} para tu usuario.`,
          en: `✅ Done: the «${alerta}» alert by ${canal} is now ${p.activar ? 'on' : 'off'} for your user.`,
          fr: `✅ C'est fait : l'alerte «${alerta}» par ${canal} est maintenant ${p.activar ? 'activée' : 'désactivée'} pour votre utilisateur.`,
        }),
      };
    },
  });
}
