import { z } from 'zod';
import { segunIdioma } from '../domain/language.js';
import { elegirHorario, horariosParaBackend, listarHorarios } from '../domain/route-schedule.js';
import { utcOffsetMinutes } from '../domain/timezone.js';
import { elegirRutaConDetalle } from './support/route-lookup.js';
import {
  DESDE,
  describirFranja,
  DIAS_PARAM,
  HASTA,
  horariosUtc,
  HORAS_LOCALES,
  RUTA,
} from './support/schedule.js';
import { INTERNO } from './support/shared.js';
import { defineBotAction, type ActionDefinition, type ActionEnv } from './types.js';

/** Añadir y borrar horarios de una ruta, siempre en la hora local del cliente. */

const addTimeWindowParams = {
  ruta: RUTA,
  dias: DIAS_PARAM,
  desde: DESDE,
  hasta: HASTA,
  ruta_id: z.string().optional().describe(INTERNO),
};

export function addTimeWindow({ gateway }: ActionEnv): ActionDefinition {
  return defineBotAction({
    nombre: 'add_time_window',
    tool: 'proponer_anadir_horario',
    descripcion:
      'Prepara añadir UN horario (días y franja, para una ronda) a una ruta existente. NO lo añade: le envía al cliente un resumen con un botón ' +
      `para confirmarlo. ${HORAS_LOCALES} Si se solapa con otro horario de la ruta te lo dirá: pregunta al usuario cómo ajustarlo.`,
    params: addTimeWindowParams,
    rolMinimo: 'EDITOR',
    async preparar(ctx, p) {
      const r = await elegirRutaConDetalle(gateway, ctx, p.ruta);
      if ('error' in r) return r;
      const h = horariosParaBackend([p], utcOffsetMinutes(ctx.tz), r.detalle.timeWindows);
      if ('error' in h) return h;
      return { params: { ...p, ruta: r.ruta.name, ruta_id: r.ruta.id } };
    },
    resumen(p, { idioma, organizacion }) {
      const franja = describirFranja(p, idioma);
      return segunIdioma(idioma, {
        es: `Añadir a la ruta «${p.ruta}» de ${organizacion} el horario ${franja} (tu hora local).`,
        en: `Add to the route «${p.ruta}» of ${organizacion} the time slot ${franja} (your local time).`,
        fr: `Ajouter au parcours «${p.ruta}» de ${organizacion} le créneau ${franja} (votre heure locale).`,
      });
    },
    async ejecutar(ctx, p) {
      if (!p.ruta_id) throw new Error('add_time_window sin ruta_id (no pasó por preparar)');
      await gateway.addRouteTimeWindow(p.ruta_id, horariosUtc([p], ctx.tz)[0], ctx.token);
      const franja = describirFranja(p, ctx.language);
      return {
        texto: segunIdioma(ctx.language, {
          es: `✅ Horario ${franja} añadido a la ruta «${p.ruta}».`,
          en: `✅ Time slot ${franja} added to the route «${p.ruta}».`,
          fr: `✅ Créneau ${franja} ajouté au parcours «${p.ruta}».`,
        }),
      };
    },
  });
}

const deleteTimeWindowParams = {
  ruta: RUTA,
  horario: z
    .string()
    .trim()
    .min(1)
    .describe(
      'Cuál borrar: su número en la lista de consultar_horarios_ruta o cómo lo dice el cliente («lun 20:00-21:00»), en hora local'
    ),
  horario_id: z.string().optional().describe(INTERNO),
  horario_texto: z.string().optional().describe(INTERNO),
};

export function deleteTimeWindow({ gateway }: ActionEnv): ActionDefinition {
  return defineBotAction({
    nombre: 'delete_time_window',
    tool: 'proponer_borrar_horario',
    descripcion:
      'Prepara borrar UN horario de una ruta. NO lo borra: le envía al cliente un resumen con un botón para confirmarlo. ' +
      'Si no sabes cuál es, llama antes a consultar_horarios_ruta y enséñale la lista (en su hora local). Si hay dudas, te devuelve la lista para preguntar.',
    params: deleteTimeWindowParams,
    rolMinimo: 'EDITOR',
    async preparar(ctx, p) {
      const r = await elegirRutaConDetalle(gateway, ctx, p.ruta);
      if ('error' in r) return r;
      const horarios = listarHorarios(r.detalle.timeWindows, utcOffsetMinutes(ctx.tz));
      if (horarios.length === 0)
        return { error: `La ruta «${r.ruta.name}» no tiene ningún horario.` };
      const h = elegirHorario(horarios, p.horario);
      if ('error' in h) return h;
      return {
        params: { ...p, ruta: r.ruta.name, horario_id: h.item.id, horario_texto: h.item.texto },
      };
    },
    resumen(p, { idioma, organizacion }) {
      return segunIdioma(idioma, {
        es: `Borrar de la ruta «${p.ruta}» de ${organizacion} el horario ${p.horario_texto} (tu hora local). Dejarán de generarse rondas en él.`,
        en: `Delete from the route «${p.ruta}» of ${organizacion} the time slot ${p.horario_texto} (your local time). No more rounds will be generated in it.`,
        fr: `Supprimer du parcours «${p.ruta}» de ${organizacion} le créneau ${p.horario_texto} (votre heure locale). Aucune ronde ne sera plus générée sur ce créneau.`,
      });
    },
    async ejecutar(ctx, p) {
      if (!p.horario_id)
        throw new Error('delete_time_window sin horario_id (no pasó por preparar)');
      await gateway.deleteRouteTimeWindow(p.horario_id, ctx.token);
      return {
        texto: segunIdioma(ctx.language, {
          es: `✅ Horario ${p.horario_texto} borrado de la ruta «${p.ruta}».`,
          en: `✅ Time slot ${p.horario_texto} deleted from the route «${p.ruta}».`,
          fr: `✅ Créneau ${p.horario_texto} supprimé du parcours «${p.ruta}».`,
        }),
      };
    },
  });
}
