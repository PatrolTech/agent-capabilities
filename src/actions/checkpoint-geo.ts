import { z } from 'zod';
import { distanciaMetros, enlaceMapa, formatoDistancia } from '../domain/geo.js';
import { segunIdioma } from '../domain/language.js';
import type { CheckpointDetail, PatrolTechGateway } from '../gateway/index.js';
import {
  antifraudParams,
  bloqueoAntifraude,
  mismasReglas,
  normalizar,
  reglasConCambios,
  textoGps,
  textoSubterraneo,
  tocaGps,
} from './support/antifraud-rules.js';
import { INTERNO, resolverCheckpoint, sinCambios } from './support/shared.js';
import {
  defineBotAction,
  type ActionDefinition,
  type ActionEnv,
  type ActionPrepareContext,
} from './types.js';

/**
 * Antifraude y posición de un checkpoint: los avisos
 * diarios de escaneo sospechoso por una distancia demasiado ajustada, por el modo
 * subterráneo en un punto al aire libre o por un punto mal situado en el mapa.
 * Las dos escriben con `PUT /api/checkpoints/:id`, cada una SOLO con su campo.
 */

/** El checkpoint dicho por el usuario, entre los de la organización, con su posición y sus reglas actuales. */
async function leerCheckpoint(
  gateway: PatrolTechGateway,
  ctx: ActionPrepareContext,
  checkpoint: string,
  ubicacion: string | undefined
): Promise<{ detalle: CheckpointDetail; ubicacion: string } | { error: string }> {
  const { items } = await gateway.listCheckpoints(ctx.org.orgId, ctx.token);
  const r = resolverCheckpoint(items, checkpoint, ubicacion);
  if ('error' in r) return r;
  const detalle = await gateway.getCheckpointDetail(
    { id: r.item.id, locationId: r.item.locationId, name: r.item.name },
    ctx.token
  );
  if (!detalle)
    return {
      error: `No he podido leer el checkpoint «${r.item.name}». No lo propongas: que lo revise en el panel (Checkpoints).`,
    };
  return { detalle, ubicacion: r.item.locationName };
}

// ---------------------------------------------------------------------------
// edit_checkpoint_antifraud
// ---------------------------------------------------------------------------

export function editCheckpointAntifraud({ gateway }: ActionEnv): ActionDefinition {
  return defineBotAction({
    nombre: 'edit_checkpoint_antifraud',
    tool: 'proponer_cambiar_antifraude',
    descripcion:
      'Prepara cambiar las reglas antifraude de un checkpoint: la proximidad GPS (distancia máxima entre el móvil y el punto) y el modo ' +
      'subterráneo (avisa si el móvil tiene cobertura en el punto). NO lo cambia: le envía al cliente un resumen con un botón para ' +
      'confirmarlo. Úsala cuando los avisos de escaneo sospechoso se deban a una distancia demasiado ajustada (súbela, p. ej. a 100 m) o al ' +
      'modo subterráneo en un punto con cobertura (desactívalo). Si el punto está mal situado en el mapa, lo que toca es proponer_mover_checkpoint. ' +
      'Afecta solo a los escaneos nuevos.',
    params: antifraudParams,
    rolMinimo: 'EDITOR',
    async preparar(ctx, p) {
      if (p.proximidad_gps === undefined && !tocaGps(p) && p.modo_subterraneo === undefined) {
        return {
          error:
            'Falta qué cambiar: la proximidad GPS (activarla, desactivarla o su distancia) o el modo subterráneo. Pregúntaselo al usuario.',
        };
      }
      if (
        p.proximidad_gps === false &&
        (p.distancia_maxima_m !== undefined || p.precision_maxima_m !== undefined)
      ) {
        return {
          error:
            'Contradictorio: desactivar la proximidad GPS y a la vez cambiar su distancia o su precisión. Pregunta al usuario qué quiere.',
        };
      }
      const leido = await leerCheckpoint(gateway, ctx, p.checkpoint, p.ubicacion);
      if ('error' in leido) return leido;
      const { detalle } = leido;
      switch (bloqueoAntifraude(detalle, p)) {
        case 'reglas_desconocidas':
          return {
            error:
              `El checkpoint «${detalle.name}» tiene reglas antifraude que no puedo cambiar desde aquí sin perderlas (${detalle.reglasDesconocidas.join(', ')}). ` +
              'No lo propongas: que lo cambie en el panel (Checkpoints → editar → Antifraude).',
          };
        case 'geocerca':
          return {
            error: `El checkpoint «${detalle.name}» verifica por geocerca, que ya es la comprobación de distancia: la proximidad GPS no se le aplica. Su radio se cambia en el panel.`,
          };
        case 'sin_posicion':
          return {
            error:
              `El checkpoint «${detalle.name}» no tiene posición guardada, y la proximidad GPS mide la distancia a ella. No lo propongas aún: ` +
              'pide al cliente que vaya al punto y te comparta su ubicación de WhatsApp desde allí, propón con ella proponer_mover_checkpoint y, cuando esté hecho, esto.',
          };
      }
      const antes = normalizar(detalle.reglasAntifraude);
      const despues = reglasConCambios(detalle.reglasAntifraude, p);
      if (mismasReglas(antes, despues))
        return {
          error: `El checkpoint «${detalle.name}» ya tiene esas reglas antifraude: no hay nada que cambiar.`,
        };
      return {
        params: {
          ...p,
          checkpoint: detalle.name,
          ubicacion: leido.ubicacion,
          checkpoint_id: detalle.id,
          ubicacion_id: detalle.locationId,
          reglas_antes: antes,
          reglas_despues: despues,
        },
      };
    },
    resumen(p, { idioma, organizacion }) {
      const antes = p.reglas_antes ?? {};
      const despues = p.reglas_despues ?? {};
      const t = segunIdioma(idioma, {
        es: { gps: 'proximidad GPS', sub: 'modo subterráneo', sep: ':' },
        en: { gps: 'GPS proximity', sub: 'underground mode', sep: ':' },
        fr: { gps: 'proximité GPS', sub: 'mode souterrain', sep: ' :' },
      });
      const cambios: string[] = [];
      if (JSON.stringify(antes.gpsProximity) !== JSON.stringify(despues.gpsProximity)) {
        cambios.push(
          `${t.gps}${t.sep} ${textoGps(antes.gpsProximity, idioma)} → ${textoGps(despues.gpsProximity, idioma)}`
        );
      }
      if (Boolean(antes.undergroundMode?.enabled) !== Boolean(despues.undergroundMode?.enabled)) {
        cambios.push(
          `${t.sub}${t.sep} ${textoSubterraneo(antes.undergroundMode, idioma)} → ${textoSubterraneo(despues.undergroundMode, idioma)}`
        );
      }
      const lista = cambios.join('; ');
      return segunIdioma(idioma, {
        es:
          `Cambiar el antifraude del checkpoint «${p.checkpoint}» de la ubicación «${p.ubicacion}» de ${organizacion}: ${lista}. ` +
          'Afecta a los escaneos nuevos; los avisos ya enviados no cambian.',
        en:
          `Change the anti-fraud settings of the checkpoint «${p.checkpoint}» in the location «${p.ubicacion}» of ${organizacion}: ${lista}. ` +
          'It applies to new scans; alerts already sent do not change.',
        fr:
          `Modifier l'anti-fraude du checkpoint «${p.checkpoint}» du site «${p.ubicacion}» de ${organizacion} : ${lista}. ` +
          "Cela s'applique aux nouveaux scans ; les alertes déjà envoyées ne changent pas.",
      });
    },
    async ejecutar(ctx, p) {
      if (!p.checkpoint_id || !p.ubicacion_id)
        throw new Error('edit_checkpoint_antifraud sin checkpoint_id (no pasó por preparar)');
      // Leer-fusionar-escribir al confirmar, no al proponer: lo cambiado entretanto en el panel no se pisa.
      // Entre esta lectura y el PUT queda una ventana de milisegundos: la API no tiene versión para cerrarla.
      const actual = await gateway.getCheckpointDetail(
        { id: p.checkpoint_id, locationId: p.ubicacion_id, name: p.checkpoint },
        ctx.token
      );
      // La lectura busca por nombre; renombrado entretanto cuenta como «ya no está» (pedirlo de nuevo lo arregla).
      if (!actual) {
        throw sinCambios(ctx.language, {
          es: `el checkpoint «${p.checkpoint}» ya no está en la ubicación «${p.ubicacion}» (quizá se borró, archivó o renombró desde el panel). Pídemelo de nuevo si hace falta.`,
          en: `the checkpoint «${p.checkpoint}» is no longer in the location «${p.ubicacion}» (it may have been deleted, archived or renamed in the dashboard). Ask me again if needed.`,
          fr: `le checkpoint «${p.checkpoint}» n'est plus sur le site «${p.ubicacion}» (il a peut-être été supprimé, archivé ou renommé depuis le tableau de bord). Redemandez-le-moi si besoin.`,
        });
      }
      switch (bloqueoAntifraude(actual, p)) {
        case 'reglas_desconocidas':
          throw sinCambios(ctx.language, {
            es: `el checkpoint «${p.checkpoint}» tiene ahora reglas antifraude que no puedo cambiar desde aquí sin perderlas. Cámbialo en el panel (Checkpoints → editar → Antifraude).`,
            en: `the checkpoint «${p.checkpoint}» now has anti-fraud rules I can't change from here without losing them. Change it in the dashboard (Checkpoints → edit → Anti-fraud).`,
            fr: `le checkpoint «${p.checkpoint}» a maintenant des règles anti-fraude que je ne peux pas modifier d'ici sans les perdre. Modifiez-le dans le tableau de bord (Checkpoints → modifier → Anti-fraude).`,
          });
        case 'geocerca':
          throw sinCambios(ctx.language, {
            es: `el checkpoint «${p.checkpoint}» verifica ahora por geocerca, que ya comprueba la distancia: la proximidad GPS no se le aplica. Su radio se cambia en el panel.`,
            en: `the checkpoint «${p.checkpoint}» is now verified by geofence, which already checks the distance: GPS proximity doesn't apply to it. Its radius is changed in the dashboard.`,
            fr: `le checkpoint «${p.checkpoint}» est maintenant vérifié par géorepérage, qui contrôle déjà la distance : la proximité GPS ne s'y applique pas. Son rayon se modifie dans le tableau de bord.`,
          });
        case 'sin_posicion':
          throw sinCambios(ctx.language, {
            es: `el checkpoint «${p.checkpoint}» ya no tiene posición guardada, y la proximidad GPS mide la distancia a ella. Compárteme tu ubicación de WhatsApp desde el punto para fijarla y pídemelo de nuevo.`,
            en: `the checkpoint «${p.checkpoint}» no longer has a saved position, and GPS proximity measures the distance to it. Share your WhatsApp location with me from the checkpoint to set it, then ask me again.`,
            fr: `le checkpoint «${p.checkpoint}» n'a plus de position enregistrée, et la proximité GPS mesure la distance par rapport à elle. Partagez-moi votre position WhatsApp depuis le point pour la définir, puis redemandez-le-moi.`,
          });
      }
      const nuevas = reglasConCambios(actual.reglasAntifraude, p);
      // Sin ninguna regla, null: lo mismo que guarda el panel.
      await gateway.updateCheckpointFraudRules(
        { id: p.checkpoint_id, fraudRules: Object.keys(nuevas).length > 0 ? nuevas : null },
        ctx.token
      );
      return {
        texto: segunIdioma(ctx.language, {
          es: `✅ Antifraude del checkpoint «${p.checkpoint}» actualizado en la ubicación «${p.ubicacion}» de ${ctx.org.name}.`,
          en: `✅ Anti-fraud settings of the checkpoint «${p.checkpoint}» updated in the location «${p.ubicacion}» of ${ctx.org.name}.`,
          fr: `✅ Anti-fraude du checkpoint «${p.checkpoint}» mis à jour sur le site «${p.ubicacion}» de ${ctx.org.name}.`,
        }),
      };
    },
  });
}

// ---------------------------------------------------------------------------
// move_checkpoint
// ---------------------------------------------------------------------------

const moveParams = {
  checkpoint: z.string().trim().min(1).describe('Nombre del checkpoint'),
  ubicacion: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe('Ubicación del checkpoint, si hay varios con ese nombre. OMÍTELO si no hace falta.'),
  latitud: z
    .number()
    .min(-90)
    .max(90)
    .describe(
      'Latitud de la ubicación que el cliente ha compartido DESDE el punto («latitud …» del mensaje). Nunca inventada ni sacada de una dirección.'
    ),
  longitud: z
    .number()
    .min(-180)
    .max(180)
    .describe('Longitud de esa misma ubicación compartida («longitud …» del mensaje).'),
  checkpoint_id: z.string().optional().describe(INTERNO),
  latitud_actual: z.number().optional().describe(INTERNO),
  longitud_actual: z.number().optional().describe(INTERNO),
  proximidad_m: z.number().optional().describe(INTERNO),
  geocerca: z.boolean().optional().describe(INTERNO),
};

export function moveCheckpoint({ gateway }: ActionEnv): ActionDefinition {
  return defineBotAction({
    nombre: 'move_checkpoint',
    tool: 'proponer_mover_checkpoint',
    descripcion:
      'Prepara corregir la posición en el mapa de un checkpoint (sus coordenadas). NO lo cambia: le envía al cliente un resumen con un ' +
      'botón para confirmarlo. Las coordenadas salen SOLO de la ubicación que el cliente te comparte por WhatsApp estando EN el punto ' +
      '(te llega como «[El usuario ha compartido una ubicación: latitud X, longitud Y]»). Si no te la ha mandado, pídesela antes. Su QR, ' +
      'su código y sus escaneos no cambian.',
    params: moveParams,
    rolMinimo: 'EDITOR',
    async preparar(ctx, p) {
      // (0, 0) es mar abierto; casi siempre es un GPS sin señal o un valor por defecto, no un punto real.
      if (p.latitud === 0 && p.longitud === 0) {
        return {
          error:
            'Las coordenadas (0, 0) no son una posición real (GPS sin señal). Pide al cliente que vuelva a compartir su ubicación desde el punto.',
        };
      }
      const leido = await leerCheckpoint(gateway, ctx, p.checkpoint, p.ubicacion);
      if ('error' in leido) return leido;
      const { detalle } = leido;
      const anterior =
        detalle.latitud !== null && detalle.longitud !== null
          ? { lat: detalle.latitud, lng: detalle.longitud }
          : null;
      if (anterior) {
        const distancia = distanciaMetros(anterior, { lat: p.latitud, lng: p.longitud });
        if (distancia < 1)
          return {
            error: `El checkpoint «${detalle.name}» ya está en esa posición: no hay nada que cambiar.`,
          };
        // Latitud y longitud al revés (copiadas a mano): la dada cae lejísimos y la girada, junto a la de antes.
        if (
          distancia > 100_000 &&
          Math.abs(p.longitud) <= 90 &&
          distanciaMetros(anterior, { lat: p.longitud, lng: p.latitud }) < 5_000
        ) {
          return {
            error:
              `Parece que la latitud y la longitud van al revés: así el checkpoint «${detalle.name}» se iría a ${formatoDistancia(distancia, 'es')} de donde está. ` +
              'No lo propongas así: comprueba el orden con la ubicación compartida («latitud …, longitud …»).',
          };
        }
      }
      return {
        params: {
          checkpoint: detalle.name,
          ubicacion: leido.ubicacion,
          latitud: p.latitud,
          longitud: p.longitud,
          checkpoint_id: detalle.id,
          latitud_actual: anterior?.lat,
          longitud_actual: anterior?.lng,
          proximidad_m: detalle.reglasAntifraude.gpsProximity?.maxDistanceMeters,
          geocerca: detalle.metodo === 'geofence' || undefined,
        },
      };
    },
    resumen(p, { idioma, organizacion }) {
      const mapa = enlaceMapa(p.latitud, p.longitud);
      const dist =
        p.latitud_actual !== undefined && p.longitud_actual !== undefined
          ? formatoDistancia(
              distanciaMetros(
                { lat: p.latitud_actual, lng: p.longitud_actual },
                { lat: p.latitud, lng: p.longitud }
              ),
              idioma
            )
          : null;
      const lineas = [
        segunIdioma(idioma, {
          es: `Mover el checkpoint «${p.checkpoint}» de la ubicación «${p.ubicacion}» de ${organizacion} a su nueva posición: ${mapa} (${dist ? `a ${dist} de la anterior` : 'no tenía posición guardada'}).`,
          en: `Move the checkpoint «${p.checkpoint}» in the location «${p.ubicacion}» of ${organizacion} to its new position: ${mapa} (${dist ? `${dist} from the previous one` : 'it had no saved position'}).`,
          fr: `Déplacer le checkpoint «${p.checkpoint}» du site «${p.ubicacion}» de ${organizacion} à sa nouvelle position : ${mapa} (${dist ? `à ${dist} de la précédente` : "il n'avait pas de position enregistrée"}).`,
        }),
      ];
      if (p.proximidad_m !== undefined) {
        lineas.push(
          segunIdioma(idioma, {
            es: `⚠️ Tiene activada la proximidad GPS (máx. ${p.proximidad_m} m): los escaneos se medirán desde esta nueva posición.`,
            en: `⚠️ GPS proximity is on (max. ${p.proximidad_m} m): scans will be measured from this new position.`,
            fr: `⚠️ La proximité GPS est activée (max. ${p.proximidad_m} m) : les scans seront mesurés depuis cette nouvelle position.`,
          })
        );
      }
      if (p.geocerca) {
        lineas.push(
          segunIdioma(idioma, {
            es: '⚠️ Verifica por geocerca: los escaneos se comprobarán contra esta nueva posición.',
            en: '⚠️ It is verified by geofence: scans will be checked against this new position.',
            fr: '⚠️ Il est vérifié par géorepérage : les scans seront contrôlés par rapport à cette nouvelle position.',
          })
        );
      }
      return lineas.join('\n');
    },
    async ejecutar(ctx, p) {
      if (!p.checkpoint_id)
        throw new Error('move_checkpoint sin checkpoint_id (no pasó por preparar)');
      await gateway.moveCheckpoint(
        { id: p.checkpoint_id, latitude: p.latitud, longitude: p.longitud },
        ctx.token
      );
      const mapa = enlaceMapa(p.latitud, p.longitud);
      return {
        texto: segunIdioma(ctx.language, {
          es: `✅ Checkpoint «${p.checkpoint}» movido en la ubicación «${p.ubicacion}» de ${ctx.org.name}: ${mapa}`,
          en: `✅ Checkpoint «${p.checkpoint}» moved in the location «${p.ubicacion}» of ${ctx.org.name}: ${mapa}`,
          fr: `✅ Checkpoint «${p.checkpoint}» déplacé sur le site «${p.ubicacion}» de ${ctx.org.name} : ${mapa}`,
        }),
      };
    },
  });
}
