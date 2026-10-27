import { z } from 'zod';
import { isFeatureDisabled, PatrolTechApiError } from '../domain/backend-errors.js';
import {
  INCIDENT_FINAL,
  INCIDENT_REQUIRES_ASSIGNMENT,
  INCIDENT_REQUIRES_COMMENT,
  INCIDENT_STATUS_LABELS,
  INCIDENT_STATUS_PARAM,
  INCIDENT_STATUS_PARAMS,
  INCIDENT_TRANSITIONS,
  type IncidentStatus,
  type IncidentStatusParam,
} from '../domain/incident-status.js';
import { segunIdioma } from '../domain/language.js';
import type { IncidentRef } from '../gateway/index.js';
import { INTERNO, resolver } from './support/shared.js';
import { defineBotAction, type ActionDefinition, type ActionEnv } from './types.js';

/** Cambiar el estado, asignar y comentar una incidencia. */

const ESTADO_PARAM = INCIDENT_STATUS_PARAM;
const ESTADOS_PARAM = INCIDENT_STATUS_PARAMS;
const paramDe = (s: IncidentStatus): IncidentStatusParam =>
  ESTADOS_PARAM.find((k) => ESTADO_PARAM[k] === s)!;

/** `asignar_a_id` cuando se la asigna el propio usuario: su id solo se conoce al ejecutar (la sesión del momento). */
const ASIGNAR_A_MI = '@yo';
const YO_RE = /^(yo|a m[ií]|me|a m[ií] mismo|m[ií] mismo|myself|to me)$/i;

const incidentParams = {
  incidencia: z
    .string()
    .trim()
    .min(1)
    .describe(
      'Título de la incidencia (o parte de él), o su `id` tal como sale en la lista de incidencias'
    ),
  estado: z
    .enum(ESTADOS_PARAM)
    .optional()
    .describe(
      'Estado nuevo: abierto, en_progreso (exige que esté asignada), resuelto (exige comentario), cerrado (DEFINITIVO) o descartado (exige comentario; DEFINITIVO). OMÍTELO si no cambia el estado.'
    ),
  comentario: z
    .string()
    .trim()
    .min(1)
    .max(2000)
    .optional()
    .describe('Comentario a añadir. Obligatorio para resuelto y descartado (el motivo).'),
  asignar_a: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe(
      'Usuario del panel al que asignarla (nombre o email), o «yo» si se la asigna el propio usuario. OMÍTELO si no se reasigna.'
    ),
  incidencia_id: z.string().optional().describe(INTERNO),
  ubicacion_id: z.string().optional().describe(INTERNO),
  estado_actual: z.enum(ESTADOS_PARAM).optional().describe(INTERNO),
  asignar_a_id: z.string().optional().describe(INTERNO),
};

export function incidentUpdate({ gateway, logger }: ActionEnv): ActionDefinition {
  return defineBotAction({
    nombre: 'incident_update',
    tool: 'proponer_actualizar_incidencia',
    descripcion:
      'Prepara un cambio en una incidencia de la App de Incidencias: cambiar su estado, asignarla y/o añadir un comentario, en una sola confirmación. ' +
      'NO lo hace: le envía al cliente un resumen con un botón para confirmarlo. Estados: Abierto → En progreso (exige asignarla) o Descartado; ' +
      'En progreso → Resuelto, Abierto o Descartado; Resuelto → Cerrado o En progreso. Resuelto y Descartado exigen comentario. Cerrado y Descartado son ' +
      'DEFINITIVOS. Si no sabes cuál es la incidencia, usa antes consultar_incidencias. Solo se puede asignar a otra persona si el usuario es Admin; ' +
      'cualquiera puede asignársela a sí mismo («yo»).',
    params: incidentParams,
    rolMinimo: 'EDITOR',
    async preparar(ctx, p) {
      if (!p.estado && !p.comentario && !p.asignar_a) {
        return {
          error:
            'Falta qué cambiar: el estado, a quién asignarla o el comentario. Pregúntaselo al usuario.',
        };
      }
      let incidencias: IncidentRef[];
      try {
        incidencias = (await gateway.listIncidents(ctx.org.orgId, ctx.token)).items.filter(
          (i) => i.titulo !== null
        );
      } catch (err) {
        if (isFeatureDisabled(err)) {
          return {
            error: `La App de Incidencias no está activa en «${ctx.org.name}». La activa un Admin en el panel, en Apps → Gestión de Incidencias.`,
          };
        }
        if (err instanceof PatrolTechApiError && err.status === 403) {
          return {
            error:
              'El usuario no puede ver las incidencias de la organización con su rol: que lo haga desde el panel o un Admin.',
          };
        }
        throw err;
      }
      const r = resolver(
        p.incidencia,
        incidencias,
        (i) => i.titulo ?? '',
        ['la incidencia', 'incidencias'],
        { idOf: (i) => i.id }
      );
      if ('error' in r) return r;
      const inc = r.item;
      const actual = INCIDENT_STATUS_LABELS[inc.estado].es;
      if (INCIDENT_FINAL.includes(inc.estado)) {
        return {
          error: `La incidencia «${inc.titulo}» está ${actual}, que es DEFINITIVO: ya no se puede cambiar ni comentar.`,
        };
      }

      const nuevo = p.estado ? ESTADO_PARAM[p.estado] : undefined;
      if (nuevo) {
        if (nuevo === inc.estado)
          return { error: `La incidencia «${inc.titulo}» ya está ${actual}.` };
        const permitidos = INCIDENT_TRANSITIONS[inc.estado];
        if (!permitidos.includes(nuevo)) {
          return {
            error:
              `Desde ${actual} no se puede pasar a ${INCIDENT_STATUS_LABELS[nuevo].es}. ` +
              `Desde ${actual} solo se puede pasar a: ${permitidos.map((s) => INCIDENT_STATUS_LABELS[s].es).join(', ')}.`,
          };
        }
        if (INCIDENT_REQUIRES_COMMENT.includes(nuevo) && !p.comentario) {
          return {
            error: `Para pasarla a ${INCIDENT_STATUS_LABELS[nuevo].es} hace falta un comentario con el motivo: pídeselo al usuario.`,
          };
        }
        if (INCIDENT_REQUIRES_ASSIGNMENT.includes(nuevo) && !inc.asignadoAId && !p.asignar_a) {
          return {
            error:
              'Para pasarla a En progreso tiene que estar asignada: pregunta al usuario a quién asignarla (o si se la asigna él, «yo»).',
          };
        }
      }

      let asignarA: { id: string; nombre: string } | undefined;
      if (p.asignar_a) {
        if (YO_RE.test(p.asignar_a)) {
          asignarA = { id: ASIGNAR_A_MI, nombre: 'yo' };
        } else {
          let usuarios;
          try {
            usuarios = await gateway.listOrgUsers(ctx.org.orgId, ctx.token);
          } catch (err) {
            if (err instanceof PatrolTechApiError && err.status === 403) {
              return {
                error:
                  'Solo un Admin puede ver los usuarios para asignar la incidencia a otra persona. El usuario sí puede asignársela a sí mismo («yo»).',
              };
            }
            throw err;
          }
          const u = resolver(p.asignar_a, usuarios, (x) => x.nombre, ['el usuario', 'usuarios'], {
            idOf: (x) => x.email,
          });
          if ('error' in u) return u;
          asignarA = { id: u.item.id, nombre: u.item.nombre };
        }
      }

      return {
        params: {
          ...p,
          incidencia: inc.titulo ?? p.incidencia,
          incidencia_id: inc.id,
          ubicacion_id: inc.locationId ?? undefined,
          estado_actual: paramDe(inc.estado),
          asignar_a: asignarA?.nombre,
          asignar_a_id: asignarA?.id,
        },
      };
    },
    resumen(p, { idioma, organizacion }) {
      const partes: string[] = [];
      const nuevo = p.estado ? ESTADO_PARAM[p.estado] : undefined;
      if (nuevo) {
        const de = p.estado_actual
          ? INCIDENT_STATUS_LABELS[ESTADO_PARAM[p.estado_actual]][idioma]
          : undefined;
        const a = INCIDENT_STATUS_LABELS[nuevo][idioma];
        partes.push(
          segunIdioma(idioma, {
            es: `cambiar su estado${de ? ` de «${de}»` : ''} a «${a}»${p.comentario ? ` con el comentario «${p.comentario}»` : ''}`,
            en: `change its status${de ? ` from «${de}»` : ''} to «${a}»${p.comentario ? ` with the comment «${p.comentario}»` : ''}`,
            fr: `passer son statut${de ? ` de «${de}»` : ''} à «${a}»${p.comentario ? ` avec le commentaire «${p.comentario}»` : ''}`,
          })
        );
      } else if (p.comentario) {
        partes.push(
          segunIdioma(idioma, {
            es: `añadir el comentario «${p.comentario}»`,
            en: `add the comment «${p.comentario}»`,
            fr: `ajouter le commentaire «${p.comentario}»`,
          })
        );
      }
      if (p.asignar_a_id) {
        const aMi = p.asignar_a_id === ASIGNAR_A_MI;
        partes.push(
          segunIdioma(idioma, {
            es: aMi ? 'asignártela a ti' : `asignarla a ${p.asignar_a}`,
            en: `assign it to ${aMi ? 'you' : p.asignar_a}`,
            fr: aMi ? "vous l'assigner" : `l'assigner à ${p.asignar_a}`,
          })
        );
      }
      const lista = partes.join('; ');
      const texto = segunIdioma(idioma, {
        es: `En la incidencia «${p.incidencia}» de ${organizacion}: ${lista}.`,
        en: `In the incident «${p.incidencia}» of ${organizacion}: ${lista}.`,
        fr: `Dans l'incident «${p.incidencia}» de ${organizacion} : ${lista}.`,
      });
      if (!nuevo || !INCIDENT_FINAL.includes(nuevo)) return texto;
      const estado = INCIDENT_STATUS_LABELS[nuevo][idioma].toUpperCase();
      return segunIdioma(idioma, {
        es: `${texto}\n⚠️ «${estado}» ES DEFINITIVO: DESPUÉS LA INCIDENCIA NO SE PODRÁ REABRIR NI MODIFICAR.`,
        en: `${texto}\n⚠️ «${estado}» IS FINAL: THE INCIDENT CANNOT BE REOPENED OR CHANGED AFTERWARDS.`,
        fr: `${texto}\n⚠️ «${estado}» EST DÉFINITIF : L'INCIDENT NE POURRA PLUS ÊTRE ROUVERT NI MODIFIÉ.`,
      });
    },
    async ejecutar(ctx, p) {
      if (!p.incidencia_id)
        throw new Error('incident_update sin incidencia_id (no pasó por preparar)');
      const t = segunIdioma(ctx.language, {
        es: {
          asignada: (quien?: string) => `asignada a ${quien}`,
          estado: 'estado',
          comentario: 'comentario añadido',
        },
        en: {
          asignada: (quien?: string) => `assigned to ${quien}`,
          estado: 'status',
          comentario: 'comment added',
        },
        fr: {
          asignada: (quien?: string) => `assigné à ${quien}`,
          estado: 'statut',
          comentario: 'commentaire ajouté',
        },
      });
      const target = {
        incidentId: p.incidencia_id,
        organizationId: ctx.org.orgId,
        locationId: p.ubicacion_id ?? null,
      };
      const hecho: string[] = [];
      // Primero la asignación: pasar a En progreso la exige, y en un estado definitivo ya no se podría.
      if (p.asignar_a_id) {
        const aMi = p.asignar_a_id === ASIGNAR_A_MI;
        await gateway.assignIncident(
          { ...target, userId: aMi ? ctx.user.id : p.asignar_a_id },
          ctx.token
        );
        hecho.push(t.asignada(aMi ? ctx.user.name : p.asignar_a));
      }
      const nuevo = p.estado ? ESTADO_PARAM[p.estado] : undefined;
      try {
        if (nuevo) {
          await gateway.updateIncidentStatus(
            { ...target, estado: nuevo, ...(p.comentario ? { comentario: p.comentario } : {}) },
            ctx.token
          );
          hecho.push(`${t.estado} «${INCIDENT_STATUS_LABELS[nuevo][ctx.language]}»`);
          if (p.comentario) hecho.push(t.comentario);
        } else if (p.comentario) {
          await gateway.commentIncident({ ...target, comentario: p.comentario }, ctx.token);
          hecho.push(t.comentario);
        }
      } catch (err) {
        // Con la asignación ya hecha, «no se ha hecho ningún cambio» sería falso: se dice lo que sí se hizo.
        if (hecho.length === 0) throw err;
        logger.warn('bot_action.incident_update_partial', { incidentId: p.incidencia_id, err });
        const lista = hecho.join('; ');
        return {
          texto: segunIdioma(ctx.language, {
            es: `✅ Incidencia «${p.incidencia}»: ${lista}.\n⚠️ Pero ${nuevo ? 'el cambio de estado' : 'el comentario'} no se ha podido hacer: revísalo en el panel (Incidencias).`,
            en: `✅ Incident «${p.incidencia}»: ${lista}.\n⚠️ But the ${nuevo ? 'status change' : 'comment'} could not be made: check it in the dashboard (Incidents).`,
            fr: `✅ Incident «${p.incidencia}» : ${lista}.\n⚠️ Mais ${nuevo ? 'le changement de statut' : 'le commentaire'} n'a pas pu être effectué : vérifiez-le dans le tableau de bord (Incidents).`,
          }),
        };
      }
      const lista = hecho.join('; ');
      return {
        texto: segunIdioma(ctx.language, {
          es: `✅ Incidencia «${p.incidencia}» actualizada en ${ctx.org.name}: ${lista}.`,
          en: `✅ Incident «${p.incidencia}» updated in ${ctx.org.name}: ${lista}.`,
          fr: `✅ Incident «${p.incidencia}» mis à jour dans ${ctx.org.name} : ${lista}.`,
        }),
      };
    },
  });
}
