import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { segunIdioma, type FixedTextLanguage } from '../domain/language.js';
import { efectoDeQuitar } from '../domain/route-checkpoints.js';
import { horariosParaBackend } from '../domain/route-schedule.js';
import { utcOffsetMinutes } from '../domain/timezone.js';
import type { PatrolTechGateway } from '../gateway/index.js';
import type { Logger } from '../ports/Logger.js';
import { efectoEnElLote, leerRuta, rutaEnElLote } from './support/route-impact.js';
import {
  elegirCheckpointParaRuta,
  elegirRuta,
  elegirRutaConDetalle,
} from './support/route-lookup.js';
import {
  describirFranja,
  franjaSchema,
  horariosUtc,
  HORAS_LOCALES,
  RUTA,
} from './support/schedule.js';
import { avisoRutaVacia, elegir, INTERNO, maybeApplied, ubicacionPara } from './support/shared.js';
import { turnoDe } from './support/turno.js';
import { defineBotAction, type ActionDefinition, type ActionEnv } from './types.js';

/**
 * Rutas: crear ruta, activar y desactivar, y añadir o quitar
 * checkpoints de una ruta. Sus horarios van en `route-schedules.ts`.
 */

const createRouteParams = {
  nombre: z.string().trim().min(1).describe('Nombre de la ruta'),
  ubicacion: z
    .string()
    .optional()
    .describe('Ubicación de la ruta. Pregúntala solo si el usuario tiene varias.'),
  checkpoints: z
    .array(z.string().trim().min(1))
    .min(1)
    .describe('Nombres de los checkpoints de la ruta, en el orden en que se recorren'),
  orden_estricto: z
    .boolean()
    .optional()
    .describe('true = hay que escanearlos en ese orden. Por defecto, no.'),
  franjas: z.array(franjaSchema).min(1).describe('Horarios de la ruta, en hora LOCAL del cliente'),
  ubicacion_id: z.string().optional().describe(INTERNO),
  checkpoint_ids: z.array(z.string()).optional().describe(INTERNO),
  ruta_id: z.string().optional().describe(INTERNO),
};

export function createRoute({ gateway }: ActionEnv): ActionDefinition {
  return defineBotAction({
    nombre: 'create_route',
    tool: 'proponer_crear_ruta',
    descripcion:
      'Prepara el alta de una ruta con sus checkpoints (en orden) y sus horarios. NO la crea: le envía al cliente un resumen con un botón ' +
      'para confirmarla. Pregunta solo lo que falte: nombre, checkpoints (ya existentes) y horarios; la ubicación solo si tiene varias. ' +
      `${HORAS_LOCALES} Si dice «cada hora», «cada 30 minutos»… y no está claro si quiere UNA ronda en toda la franja o una ronda en cada hora, ` +
      'pregúntaselo antes (p. ej. «de 20:00 a 05:00 cada hora»: ¿una ronda por hora, 9 en total?). Si quiere una por hora, usa `repetir_cada_min: 60`.',
    params: createRouteParams,
    rolMinimo: 'EDITOR',
    rolDeOrganizacion: true,
    async preparar(ctx, p) {
      const u = ubicacionPara(
        await gateway.listLocations(ctx.org.orgId, ctx.token),
        p.ubicacion,
        'crear la ruta'
      );
      if ('error' in u) return u;
      const igual = (await gateway.listRoutes(ctx.org.orgId, ctx.token)).items.find(
        (r) => r.name.trim().toLowerCase() === p.nombre.trim().toLowerCase()
      );
      if (igual)
        return {
          error: `Ya existe una ruta «${igual.name}». Pregunta al usuario si quiere otro nombre o cambiar los horarios de esa ruta.`,
        };
      const enUbicacion = (await gateway.listCheckpoints(ctx.org.orgId, ctx.token)).items.filter(
        (c) => c.locationId === u.item.id
      );
      const ids: string[] = [];
      for (const nombre of p.checkpoints) {
        const c = await elegirCheckpointParaRuta(
          gateway,
          ctx,
          nombre,
          enUbicacion,
          u.item.id,
          `los checkpoints de «${u.item.name}»`
        );
        if ('error' in c) return c;
        if (ids.includes(c.item.id))
          return {
            error: `El checkpoint «${c.item.name}» está dos veces en la lista: una ruta lo lleva una sola vez.`,
          };
        ids.push(c.item.id);
      }
      const horarios = horariosParaBackend(p.franjas, utcOffsetMinutes(ctx.tz));
      if ('error' in horarios) return horarios;
      // El id de la ruta lo pone el bot: un alta dudosa se comprueba por él.
      const rutaId = randomUUID();
      return {
        params: {
          ...p,
          ubicacion: u.item.name,
          ubicacion_id: u.item.id,
          checkpoint_ids: ids,
          ruta_id: rutaId,
        },
        idempotencyKey: rutaId,
      };
    },
    resumen(p, { idioma, organizacion }) {
      const orden = p.checkpoints.join(' → ');
      const n = p.checkpoints.length;
      const franjas = p.franjas.map((f) => `• ${describirFranja(f, idioma)}`).join('\n');
      return segunIdioma(idioma, {
        es:
          `Crear la ruta «${p.nombre}» en la ubicación «${p.ubicacion}» de ${organizacion} con ${n} checkpoints: ${orden}` +
          `${p.orden_estricto ? ' (hay que escanearlos en ese orden)' : ' (en cualquier orden)'}.\nHorarios (tu hora local):\n${franjas}`,
        en:
          `Create the route «${p.nombre}» in the location «${p.ubicacion}» of ${organizacion} with ${n} checkpoints: ${orden}` +
          `${p.orden_estricto ? ' (they must be scanned in this order)' : ' (in any order)'}.\nSchedule (your local time):\n${franjas}`,
        fr:
          `Créer le parcours «${p.nombre}» sur le site «${p.ubicacion}» de ${organizacion} avec ${n} checkpoints : ${orden}` +
          `${p.orden_estricto ? ' (à scanner dans cet ordre)' : " (dans n'importe quel ordre)"}.\nHoraires (votre heure locale) :\n${franjas}`,
      });
    },
    async ejecutar(ctx, p) {
      if (!p.ubicacion_id || !p.checkpoint_ids || !p.ruta_id)
        throw new Error('create_route sin ids (no pasó por preparar)');
      const timeWindows = horariosUtc(p.franjas, ctx.tz);
      try {
        await gateway.createRoute(
          {
            id: p.ruta_id,
            name: p.nombre,
            organizationId: ctx.org.orgId,
            locationId: p.ubicacion_id,
            requiresOrderedScan: p.orden_estricto ?? false,
            checkpoints: p.checkpoint_ids.map((checkpointId, i) => ({
              checkpointId,
              order: i + 1,
            })),
            timeWindows,
            scheduleTimezone: ctx.tz,
          },
          ctx.token
        );
      } catch (err) {
        // Un timeout o un 5xx no dice si se creó: si la ruta con nuestro id existe, se hizo.
        const hecha = maybeApplied(err)
          ? await gateway.getRouteDetails(p.ruta_id, ctx.token).catch(() => null)
          : null;
        if (!hecha) throw err;
      }
      const cps = `${p.checkpoint_ids.length} checkpoint${p.checkpoint_ids.length === 1 ? '' : 's'}`;
      const s = timeWindows.length === 1 ? '' : 's';
      const x = timeWindows.length === 1 ? '' : 'x';
      return {
        texto: segunIdioma(ctx.language, {
          es: `✅ Ruta «${p.nombre}» creada en «${p.ubicacion}» de ${ctx.org.name}, con ${cps} y ${timeWindows.length} horario${s}. Ya está activa: las rondas se generan en sus horarios.`,
          en: `✅ Route «${p.nombre}» created in «${p.ubicacion}» of ${ctx.org.name}, with ${cps} and ${timeWindows.length} time slot${s}. It's active: rounds are generated in its time slots.`,
          fr: `✅ Parcours «${p.nombre}» créé sur le site «${p.ubicacion}» de ${ctx.org.name}, avec ${cps} et ${timeWindows.length} créneau${x}. Il est actif : les rondes sont générées sur ses créneaux.`,
        }),
      };
    },
  });
}

const setRouteActiveParams = {
  ruta: RUTA,
  activa: z.boolean().describe('true = activarla; false = desactivarla'),
  ruta_id: z.string().optional().describe(INTERNO),
};

export function setRouteActive({ gateway }: ActionEnv): ActionDefinition {
  return defineBotAction({
    nombre: 'set_route_active',
    tool: 'proponer_activar_ruta',
    descripcion:
      'Prepara activar o desactivar una ruta. NO lo cambia: le envía al cliente un resumen con un botón para confirmarlo. ' +
      'Una ruta desactivada no genera rondas ni alertas (conserva sus horarios y checkpoints). Una ruta sin checkpoints no se puede activar: ' +
      'primero propón añadirle checkpoints y, cuando el cliente haya CONFIRMADO ese cambio, propón activarla (en otra confirmación, no en la misma).',
    params: setRouteActiveParams,
    rolMinimo: 'EDITOR',
    async preparar(ctx, p) {
      const r = await elegirRuta(gateway, ctx, p.ruta);
      if ('error' in r) return r;
      if (r.item.isActive === p.activa) {
        return {
          error: `La ruta «${r.item.name}» ya está ${p.activa ? 'activa' : 'desactivada'}: no hace falta cambiar nada.`,
        };
      }
      if (p.activa) {
        // El backend no deja activar una ruta sin checkpoints (ROUTE_HAS_NO_CHECKPOINTS): no se propone.
        // Vacía ahora (añadir y activar van en dos confirmaciones) o vacía tras lo que ya quita el lote.
        const detalle = await leerRuta(gateway, ctx, r.item.id);
        if (
          detalle &&
          (efectoDeQuitar(detalle, new Set()).vacia ||
            efectoDeQuitar(rutaEnElLote(ctx, detalle), new Set()).vacia)
        ) {
          return {
            error:
              `La ruta «${r.item.name}» no tiene checkpoints y una ruta sin checkpoints no se puede activar. ` +
              'No lo propongas: explícale que primero hay que añadirle checkpoints (puedes proponerlo tú) y después activarla.',
          };
        }
      }
      return { params: { ...p, ruta: r.item.name, ruta_id: r.item.id } };
    },
    resumen(p, { idioma, organizacion }) {
      if (p.activa) {
        return segunIdioma(idioma, {
          es: `Activar la ruta «${p.ruta}» de ${organizacion}: volverá a generar rondas y alertas en sus horarios.`,
          en: `Activate the route «${p.ruta}» of ${organizacion}: it will generate rounds and alerts in its time slots again.`,
          fr: `Activer le parcours «${p.ruta}» de ${organizacion} : il générera à nouveau des rondes et des alertes sur ses créneaux.`,
        });
      }
      return segunIdioma(idioma, {
        es: `Desactivar la ruta «${p.ruta}» de ${organizacion}. Mientras esté desactivada no genera rondas ni alertas.`,
        en: `Deactivate the route «${p.ruta}» of ${organizacion}. While it's deactivated it generates no rounds and no alerts.`,
        fr: `Désactiver le parcours «${p.ruta}» de ${organizacion}. Tant qu'il est désactivé, il ne génère ni rondes ni alertes.`,
      });
    },
    async ejecutar(ctx, p) {
      if (!p.ruta_id) throw new Error('set_route_active sin ruta_id (no pasó por preparar)');
      await gateway.setRouteActive(p.ruta_id, p.activa, ctx.token);
      if (p.activa) {
        return {
          texto: segunIdioma(ctx.language, {
            es: `✅ Ruta «${p.ruta}» activada.`,
            en: `✅ Route «${p.ruta}» activated.`,
            fr: `✅ Parcours «${p.ruta}» activé.`,
          }),
        };
      }
      return {
        texto: segunIdioma(ctx.language, {
          es: `✅ Ruta «${p.ruta}» desactivada: no generará rondas ni alertas.`,
          en: `✅ Route «${p.ruta}» deactivated: it won't generate rounds or alerts.`,
          fr: `✅ Parcours «${p.ruta}» désactivé : il ne générera ni rondes ni alertes.`,
        }),
      };
    },
  });
}

const routeCheckpointParams = {
  ruta: RUTA,
  checkpoint: z.string().trim().min(1).describe('Nombre del checkpoint'),
  operacion: z.enum(['añadir', 'quitar']).describe('añadir (al final de la ruta) o quitar'),
  ruta_id: z.string().optional().describe(INTERNO),
  checkpoint_id: z.string().optional().describe(INTERNO),
  orden: z.number().optional().describe(INTERNO),
  desactiva: z.boolean().optional().describe(INTERNO),
};

/**
 * Tras quitar un checkpoint que `preparar` previó que desactivaba la ruta
 * (`desactiva`): lo confirma releyéndola (el DELETE no devuelve cuerpo) y lo
 * dice. Una ruta que ya estaba inactiva no «se ha desactivado». El cambio ya
 * está hecho, así que un fallo al releer no lo convierte en error.
 */
async function avisoRutaDesactivada(
  gateway: PatrolTechGateway,
  logger: Logger,
  rutaId: string,
  token: string,
  idioma: FixedTextLanguage
): Promise<string> {
  try {
    const detalle = await gateway.getRouteDetails(rutaId, token);
    if (!detalle || detalle.isActive) return '';
  } catch (err) {
    logger.warn('bot_action.route_checkpoint_reread_failed', { rutaId, err });
    return '';
  }
  return `\n${segunIdioma(idioma, {
    es: 'La ruta se ha quedado sin checkpoints y se ha desactivado.',
    en: 'The route has no checkpoints left and has been deactivated.',
    fr: "Le parcours n'a plus de checkpoints et a été désactivé.",
  })}`;
}

export function routeCheckpoint({ gateway, logger }: ActionEnv): ActionDefinition {
  return defineBotAction({
    nombre: 'route_checkpoint',
    tool: 'proponer_cambiar_checkpoint_ruta',
    descripcion:
      'Prepara añadir un checkpoint existente al final de una ruta, o quitarlo de ella (el checkpoint no se borra). NO lo cambia: ' +
      'le envía al cliente un resumen con un botón para confirmarlo. Para varios, llámala una vez por cada uno en el MISMO turno (en el orden en que deben quedar): van juntos en una sola confirmación. ' +
      'Si cambia unos checkpoints por otros, propón primero los que se AÑADEN y después los que se quitan: una ruta que se queda vacía, aunque sea un momento, se desactiva.',
    params: routeCheckpointParams,
    rolMinimo: 'EDITOR',
    // `desactiva` y `orden` dependen de las anteriores del lote: la identidad es ruta, checkpoint y operación.
    huella: (p) => [p.ruta_id, p.checkpoint_id, p.operacion],
    async preparar(ctx, p) {
      const r = await elegirRutaConDetalle(gateway, ctx, p.ruta);
      if ('error' in r) return r;
      const enRuta = new Set(r.detalle.checkpoints.map((c) => c.checkpointId));
      // Lo que lleva la ruta tras las anteriores del lote: quitar X y luego añadirlo vale; quitarlo dos veces, no.
      const enLote = new Set(rutaEnElLote(ctx, r.detalle).checkpoints.map((c) => c.checkpointId));
      const todos = (await gateway.listCheckpoints(ctx.org.orgId, ctx.token)).items;
      const anadir = p.operacion === 'añadir';
      // Se añade uno de la ubicación de la ruta; se quita uno de los que tiene (o tenía antes del lote, para decir que ya sale).
      const candidatos = todos.filter((c) =>
        anadir ? c.locationId === r.detalle.locationId : enRuta.has(c.id) || enLote.has(c.id)
      );
      const entre = anadir
        ? 'los checkpoints de la ubicación de la ruta'
        : `los checkpoints de la ruta «${r.ruta.name}»`;
      const c = anadir
        ? await elegirCheckpointParaRuta(
            gateway,
            ctx,
            p.checkpoint,
            candidatos,
            r.detalle.locationId,
            entre
          )
        : elegir(p.checkpoint, candidatos, (x) => x.name, entre);
      if ('error' in c) return c;
      if (anadir && enLote.has(c.item.id)) {
        if (enRuta.has(c.item.id))
          return { error: `El checkpoint «${c.item.name}» ya está en la ruta «${r.ruta.name}».` };
        return {
          error: `Añadir el checkpoint «${c.item.name}» a la ruta «${r.ruta.name}» ya está propuesto en el lote pendiente: no lo repitas.`,
        };
      }
      if (!anadir && !enLote.has(c.item.id)) {
        return {
          error: `El checkpoint «${c.item.name}» ya sale de la ruta «${r.ruta.name}» con otra acción del lote pendiente: no lo repitas.`,
        };
      }
      // Al final de la ruta, detrás de los que ya añaden las anteriores del lote.
      const anadidosEnLote = turnoDe(ctx)
        .cambiosEnRuta(r.ruta.id)
        .filter((x) => x.op === 'añadir').length;
      const orden = Math.max(0, ...r.detalle.checkpoints.map((x) => x.order)) + 1 + anadidosEnLote;
      // Quitar el último que le queda (contando lo que ya quitan o añaden las anteriores del lote) la deja vacía, y el backend la desactiva.
      const desactiva = !anadir && efectoEnElLote(ctx, r.detalle, c.item.id).seDesactiva;
      return {
        params: {
          ...p,
          ruta: r.ruta.name,
          checkpoint: c.item.name,
          ruta_id: r.ruta.id,
          checkpoint_id: c.item.id,
          orden,
          desactiva,
        },
        cambiosEnRutas: [{ rutaId: r.ruta.id, checkpointId: c.item.id, op: p.operacion }],
      };
    },
    resumen(p, { idioma, organizacion }) {
      if (p.operacion === 'añadir') {
        return segunIdioma(idioma, {
          es: `Añadir el checkpoint «${p.checkpoint}» al final de la ruta «${p.ruta}» de ${organizacion}. Las rondas nuevas lo incluirán.`,
          en: `Add the checkpoint «${p.checkpoint}» at the end of the route «${p.ruta}» of ${organizacion}. New rounds will include it.`,
          fr: `Ajouter le checkpoint «${p.checkpoint}» à la fin du parcours «${p.ruta}» de ${organizacion}. Les nouvelles rondes l'incluront.`,
        });
      }
      const quitar = segunIdioma(idioma, {
        es: `Quitar el checkpoint «${p.checkpoint}» de la ruta «${p.ruta}» de ${organizacion}. Las rondas dejarán de pedirlo (el checkpoint no se borra).`,
        en: `Remove the checkpoint «${p.checkpoint}» from the route «${p.ruta}» of ${organizacion}. Rounds will no longer ask for it (the checkpoint isn't deleted).`,
        fr: `Retirer le checkpoint «${p.checkpoint}» du parcours «${p.ruta}» de ${organizacion}. Les rondes ne le demanderont plus (le checkpoint n'est pas supprimé).`,
      });
      return p.desactiva ? `${quitar}\n${avisoRutaVacia([p.ruta], idioma)}` : quitar;
    },
    async ejecutar(ctx, p) {
      if (!p.ruta_id || !p.checkpoint_id)
        throw new Error('route_checkpoint sin ids (no pasó por preparar)');
      if (p.operacion === 'añadir') {
        await gateway.addCheckpointToRoute(p.ruta_id, p.checkpoint_id, p.orden ?? 1, ctx.token);
        return {
          texto: segunIdioma(ctx.language, {
            es: `✅ Checkpoint «${p.checkpoint}» añadido a la ruta «${p.ruta}».`,
            en: `✅ Checkpoint «${p.checkpoint}» added to the route «${p.ruta}».`,
            fr: `✅ Checkpoint «${p.checkpoint}» ajouté au parcours «${p.ruta}».`,
          }),
        };
      }
      await gateway.removeCheckpointFromRoute(p.ruta_id, p.checkpoint_id, ctx.token);
      const quitado = segunIdioma(ctx.language, {
        es: `✅ Checkpoint «${p.checkpoint}» quitado de la ruta «${p.ruta}».`,
        en: `✅ Checkpoint «${p.checkpoint}» removed from the route «${p.ruta}».`,
        fr: `✅ Checkpoint «${p.checkpoint}» retiré du parcours «${p.ruta}».`,
      });
      return {
        texto:
          quitado +
          (p.desactiva
            ? await avisoRutaDesactivada(gateway, logger, p.ruta_id, ctx.token, ctx.language)
            : ''),
      };
    },
  });
}
