import { z } from 'zod';
import { segunIdioma, type FixedTextLanguage } from '../domain/language.js';
import type { ArchivedCheckpointRoute } from '../gateway/index.js';
import { rutasDelCheckpoint } from './support/route-impact.js';
import {
  avisoRutaVacia,
  INTERNO,
  listaCitada,
  resolverCheckpoint,
  sinPlazaDeCheckpoint,
} from './support/shared.js';
import { defineBotAction, type ActionDefinition, type ActionEnv } from './types.js';

/**
 * Archivar y desarchivar un checkpoint: sale de sus rutas,
 * con el aviso previo de las que se quedarían vacías y se desactivarían.
 */

// ---------------------------------------------------------------------------
// archive_checkpoint
// ---------------------------------------------------------------------------

const archiveParams = {
  checkpoint: z.string().trim().min(1).describe('Nombre del checkpoint'),
  ubicacion: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe('Ubicación del checkpoint, si hay varios con ese nombre. OMÍTELO si no hace falta.'),
  archivar: z
    .boolean()
    .describe('true = archivarlo (darlo de baja); false = desarchivarlo (recuperarlo)'),
  checkpoint_id: z.string().optional().describe(INTERNO),
  // Las rutas de las que saldría, con lo que prevé el bot: el mismo vocabulario que devuelve el backend al archivar.
  rutas: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        leftEmpty: z.boolean(),
        deactivated: z.boolean(),
      })
    )
    .optional()
    .describe(INTERNO),
};

/** Frases del resumen de archivar sobre sus rutas; con `rutas` undefined (no se pudieron leer), el aviso genérico. */
function avisoRutas(
  rutas: ArchivedCheckpointRoute[] | undefined,
  idioma: FixedTextLanguage
): string {
  if (!rutas) {
    return segunIdioma(idioma, {
      es: 'Se quitará de todas las rutas en las que esté y se cancelarán las rondas en curso de esas rutas; si alguna se queda sin checkpoints, se desactivará. Se puede desarchivar después, pero habrá que volver a añadirlo a las rutas.',
      en: 'It will be removed from every route it is on and the rounds in progress on those routes will be cancelled; if any is left without checkpoints, it will be deactivated. You can unarchive it later, but it will have to be added to the routes again.',
      fr: "Il sera retiré de tous les parcours où il figure et les rondes en cours de ces parcours seront annulées ; si l'un d'eux reste sans checkpoints, il sera désactivé. Vous pourrez le désarchiver plus tard, mais il faudra le rajouter aux parcours.",
    });
  }
  if (rutas.length === 0) {
    return segunIdioma(idioma, {
      es: 'No está en ninguna ruta. Se puede desarchivar después.',
      en: 'It is not on any route. You can unarchive it later.',
      fr: 'Il ne figure dans aucun parcours. Vous pourrez le désarchiver plus tard.',
    });
  }
  const todas = listaCitada(
    rutas.map((r) => r.name),
    idioma
  );
  const texto = segunIdioma(idioma, {
    es: `Se quitará de las rutas ${todas} y se cancelarán sus rondas en curso. Se puede desarchivar después, pero habrá que volver a añadirlo a las rutas.`,
    en: `It will be removed from the routes ${todas} and their rounds in progress will be cancelled. You can unarchive it later, but it will have to be added to the routes again.`,
    fr: `Il sera retiré des parcours ${todas} et leurs rondes en cours seront annulées. Vous pourrez le désarchiver plus tard, mais il faudra le rajouter aux parcours.`,
  });
  const seDesactivan = rutas.filter((r) => r.deactivated).map((r) => r.name);
  return seDesactivan.length > 0 ? `${texto}\n${avisoRutaVacia(seDesactivan, idioma)}` : texto;
}

/** Tras archivar: de qué rutas ha salido y cuáles ha desactivado el backend (lo que él devuelve, no lo previsto). */
function resultadoRutas(
  rutas: ArchivedCheckpointRoute[] | null,
  idioma: FixedTextLanguage
): string {
  if (!rutas || rutas.length === 0) return '';
  const desactivadas = rutas.filter((r) => r.deactivated).map((r) => r.name);
  const t = segunIdioma(idioma, {
    es: {
      quitado: 'Se ha quitado de las rutas',
      desactivadas: 'Desactivadas por quedarse sin checkpoints:',
    },
    en: {
      quitado: 'Removed from the routes',
      desactivadas: 'Deactivated for having no checkpoints left:',
    },
    fr: { quitado: 'Retiré des parcours', desactivadas: 'Désactivés faute de checkpoints :' },
  });
  const quitado = listaCitada(
    rutas.map((r) => r.name),
    idioma
  );
  let texto = `\n${t.quitado} ${quitado}.`;
  if (desactivadas.length > 0) texto += `\n${t.desactivadas} ${listaCitada(desactivadas, idioma)}.`;
  return texto;
}

export function archiveCheckpoint(env: ActionEnv): ActionDefinition {
  const { gateway, logger, urls } = env;
  return defineBotAction({
    nombre: 'archive_checkpoint',
    tool: 'proponer_archivar_checkpoint',
    descripcion:
      'Prepara archivar (dar de baja) o desarchivar (recuperar) un checkpoint. NO lo hace: le envía al cliente un resumen con un botón para ' +
      'confirmarlo. Archivado: su QR o código deja de valer y los escaneos nuevos se rechazan; sus escaneos se conservan y deja de contar para ' +
      'el plan. Además se QUITA de todas las rutas en las que esté y se cancelan las rondas en curso de esas rutas. Desarchivar vuelve a contar ' +
      'para el plan (si el plan está en su límite no se puede: se mejora en Licencia) pero NO lo devuelve a las rutas: hay que volver a añadirlo.',
    params: archiveParams,
    rolMinimo: 'EDITOR',
    // `rutas` depende de las anteriores del lote: el mismo checkpoint dos veces es la misma acción.
    huella: (p) => [p.checkpoint_id, p.archivar],
    async preparar(ctx, p) {
      const { items } = p.archivar
        ? await gateway.listCheckpoints(ctx.org.orgId, ctx.token)
        : await gateway.listArchivedCheckpoints(ctx.org.orgId, ctx.token);
      if (!p.archivar && items.length === 0)
        return { error: `«${ctx.org.name}» no tiene ningún checkpoint archivado.` };
      const r = resolverCheckpoint(items, p.checkpoint, p.ubicacion);
      if ('error' in r)
        return { error: p.archivar ? r.error : `Entre los checkpoints ARCHIVADOS: ${r.error}` };
      const resuelto = {
        ...p,
        checkpoint: r.item.name,
        ubicacion: r.item.locationName,
        checkpoint_id: r.item.id,
      };

      if (!p.archivar) {
        // Desarchivar pasa el mismo gate del plan que crear.
        const sinPlaza = await sinPlazaDeCheckpoint(env, ctx, {
          conPlan: (alLimite) =>
            `${alLimite} y desarchivar cuenta como crear uno. ` +
            `No lo propongas: explícale que puede mejorar el plan en Licencia (${urls.license}), archivar otro antes o, si su plan lo permite, desarchivarlo desde el panel con el cargo extra.`,
          sinPlan: (alLimite) =>
            `${alLimite} y desarchivar cuenta como crear uno. ` +
            'No lo propongas: explícale que puede archivar otro antes de desarchivarlo.',
        });
        if (sinPlaza) return { error: sinPlaza };
        return { params: { ...resuelto, rutas: undefined } };
      }
      const rutas = await rutasDelCheckpoint(gateway, logger, ctx, r.item);
      return {
        params: { ...resuelto, rutas },
        // Las siguientes del lote ven que ya sale de estas rutas (dos archivados pueden vaciar la misma).
        cambiosEnRutas: (rutas ?? []).map((ruta) => ({
          rutaId: ruta.id,
          checkpointId: r.item.id,
          op: 'quitar' as const,
        })),
      };
    },
    resumen(p, { idioma, organizacion }) {
      const cual = segunIdioma(idioma, {
        es: `el checkpoint «${p.checkpoint}» de la ubicación «${p.ubicacion}» de ${organizacion}`,
        en: `the checkpoint «${p.checkpoint}» in the location «${p.ubicacion}» of ${organizacion}`,
        fr: `le checkpoint «${p.checkpoint}» du site «${p.ubicacion}» de ${organizacion}`,
      });
      if (!p.archivar) {
        return segunIdioma(idioma, {
          es: `Desarchivar ${cual}: vuelve a aceptar escaneos y a contar para tu plan. No vuelve solo a las rutas en las que estaba: habrá que añadirlo de nuevo.`,
          en: `Unarchive ${cual}: it accepts scans again and counts towards your plan again. It does not go back to the routes it was on: it has to be added again.`,
          fr: `Désarchiver ${cual} : il accepte à nouveau les scans et compte à nouveau dans votre forfait. Il ne revient pas dans les parcours où il était : il faudra l'y rajouter.`,
        });
      }
      const rutas = avisoRutas(p.rutas, idioma);
      return segunIdioma(idioma, {
        es: `Archivar ${cual}.\n⚠️ Su QR o código dejará de valer: los escaneos nuevos de ese punto se rechazarán. Sus escaneos anteriores se conservan y deja de contar para tu plan. ${rutas}`,
        en: `Archive ${cual}.\n⚠️ Its QR or code will stop working: new scans of that point will be rejected. Its past scans are kept and it no longer counts towards your plan. ${rutas}`,
        fr: `Archiver ${cual}.\n⚠️ Son QR code ou son code ne fonctionnera plus : les nouveaux scans de ce point seront refusés. Ses scans précédents sont conservés et il ne compte plus dans votre forfait. ${rutas}`,
      });
    },
    async ejecutar(ctx, p) {
      if (!p.checkpoint_id)
        throw new Error('archive_checkpoint sin checkpoint_id (no pasó por preparar)');
      let rutas: ArchivedCheckpointRoute[] | null = null;
      if (p.archivar) rutas = await gateway.archiveCheckpoint(p.checkpoint_id, ctx.token);
      else await gateway.unarchiveCheckpoint(p.checkpoint_id, ctx.token);
      const a = p.archivar;
      return {
        texto:
          segunIdioma(ctx.language, {
            es: `✅ Checkpoint «${p.checkpoint}» ${a ? 'archivado' : 'desarchivado'} en la ubicación «${p.ubicacion}» de ${ctx.org.name}.`,
            en: `✅ Checkpoint «${p.checkpoint}» ${a ? 'archived' : 'unarchived'} in the location «${p.ubicacion}» of ${ctx.org.name}.`,
            fr: `✅ Checkpoint «${p.checkpoint}» ${a ? 'archivé' : 'désarchivé'} sur le site «${p.ubicacion}» de ${ctx.org.name}.`,
          }) + resultadoRutas(rutas, ctx.language),
      };
    },
  });
}
