import { z } from 'zod';
import { checkpointQrImage } from '../domain/qr-image.js';
import { segunIdioma } from '../domain/language.js';
import type { CreatedCheckpoint } from '../gateway/index.js';
import {
  INTERNO,
  maybeApplied,
  resolverCheckpoint,
  sinPlazaDeCheckpoint,
  ubicacionPara,
} from './support/shared.js';
import { defineBotAction, type ActionDefinition, type ActionEnv } from './types.js';

/**
 * Alta y edición de checkpoints. Archivar va en
 * `checkpoint-archive.ts`; el antifraude y la posición en el mapa, en `checkpoint-geo.ts`.
 */

/** Un checkpoint con el mismo nombre dado de alta en este margen se toma por el nuestro tras un error dudoso. */
export const CHECKPOINT_RECOVERY_WINDOW_MS = 5 * 60_000;

// ---------------------------------------------------------------------------
// create_checkpoint
// ---------------------------------------------------------------------------

const createCheckpointParams = {
  nombre: z
    .string()
    .trim()
    .min(1)
    .describe(
      'Nombre del checkpoint: corto, que describa el lugar y en formato normal, p. ej. «Entrada principal» o «Módulo 2, 3 y cafetería». ' +
        'No todo en mayúsculas, sin prefijos genéricos como «Checkpoint 1» o «Punto 3» ni numeración. Si el cliente lo da así ' +
        '(«Checkpoint 2 (MODULO 2,3, CAFETERIA)»), propón la versión limpia: la verá en el resumen y puede cancelar y pedir otro. ' +
        'Si insiste en su formato, respétalo.'
    ),
  ubicacion: z
    .string()
    .optional()
    .describe('Ubicación en la que crearlo. Pregúntala solo si el usuario tiene varias.'),
  metodo: z
    .enum(['qr', 'codigo_manual'])
    .describe(
      'qr (por defecto: se imprime y se pega en el punto) o codigo_manual (el vigilante teclea el código; si no puede imprimir)'
    ),
  ubicacion_id: z.string().optional().describe(INTERNO),
};

export function createCheckpoint(env: ActionEnv): ActionDefinition {
  const { gateway, urls } = env;
  /** El alta que respondió con error pero sí se hizo: mismo nombre exacto, en esa ubicación y de hace nada. */
  async function findJustCreated(
    locationId: string,
    nombre: string,
    token: string
  ): Promise<CreatedCheckpoint | undefined> {
    const candidatos = await gateway.findCheckpointsByName(locationId, nombre, token);
    const now = Date.now();
    return candidatos.find(
      (c) =>
        c.name.trim() === nombre.trim() &&
        c.creadoEn !== null &&
        now - Date.parse(c.creadoEn) <= CHECKPOINT_RECOVERY_WINDOW_MS
    );
  }

  return defineBotAction({
    nombre: 'create_checkpoint',
    tool: 'proponer_crear_checkpoint',
    descripcion:
      'Prepara el alta de un checkpoint (punto de control) en una ubicación de la organización, con QR o con código manual. ' +
      'NO lo crea: le envía al cliente un resumen con un botón para confirmarlo, y solo cuando confirma se crea y le llega el QR. ' +
      'Úsala cuando el cliente quiera crear o añadir un checkpoint. Pregunta solo lo que falte: el nombre y, si tiene varias ' +
      'ubicaciones, en cuál. Método: QR por defecto; código manual si no puede imprimir. El código lo genera el panel: no lo pidas.',
    params: createCheckpointParams,
    rolMinimo: 'EDITOR',
    async preparar(ctx, p) {
      const u = ubicacionPara(
        await gateway.listLocations(ctx.org.orgId, ctx.token),
        p.ubicacion,
        'crear el checkpoint'
      );
      if ('error' in u) return u;
      const ubicacion = u.item;

      const sinPlaza = await sinPlazaDeCheckpoint(env, ctx, {
        conPlan: (alLimite) =>
          `${alLimite}. No lo propongas: ` +
          `explícale que puede mejorar el plan en Licencia (${urls.license}) o, si su plan lo permite, añadir el checkpoint extra desde el panel.`,
        sinPlan: (alLimite) =>
          `${alLimite}. No lo propongas: explícale que la organización ya usa todos los checkpoints incluidos ` +
          'y que puede archivar uno que ya no use antes de crear otro.',
      });
      if (sinPlaza) return { error: sinPlaza };
      return { params: { ...p, ubicacion: ubicacion.name, ubicacion_id: ubicacion.id } };
    },
    resumen(p, { idioma, organizacion }) {
      const qr = p.metodo === 'qr';
      return segunIdioma(idioma, {
        es:
          `Crear el checkpoint «${p.nombre}» en la ubicación «${p.ubicacion}» de ${organizacion}, ` +
          `${qr ? 'con QR (para imprimirlo y pegarlo en el punto)' : 'con código manual'}. El código lo genera el panel.`,
        en:
          `Create the checkpoint «${p.nombre}» in the location «${p.ubicacion}» of ${organizacion}, ` +
          `${qr ? 'with a QR code (to print and stick at the checkpoint)' : 'with a manual code'}. The dashboard generates the code.`,
        fr:
          `Créer le checkpoint «${p.nombre}» sur le site «${p.ubicacion}» de ${organizacion}, ` +
          `${qr ? 'avec un QR code (à imprimer et coller au point de contrôle)' : 'avec un code manuel'}. Le code est généré par le tableau de bord.`,
      });
    },
    async ejecutar(ctx, p) {
      if (!p.ubicacion_id)
        throw new Error('create_checkpoint sin ubicacion_id (no pasó por preparar)');
      const metodo = p.metodo === 'qr' ? 'qr_static' : 'manual_code';
      let cp: CreatedCheckpoint;
      try {
        cp = await gateway.createCheckpoint(
          { name: p.nombre, locationId: p.ubicacion_id, metodo },
          ctx.token
        );
      } catch (err) {
        // Un timeout o un 5xx no dice si se creó: se busca antes de contestar «no se ha hecho nada».
        const recovered = maybeApplied(err)
          ? await findJustCreated(p.ubicacion_id, p.nombre, ctx.token).catch(() => undefined)
          : undefined;
        if (!recovered) throw err;
        cp = recovered;
      }

      const codigo = cp.codigo;
      const t = segunIdioma(ctx.language, {
        es: {
          creado: `✅ Checkpoint «${cp.name}» creado en la ubicación «${p.ubicacion}» de ${ctx.org.name}.`,
          sinCodigo: 'Su código lo tienes en el panel, en Checkpoints.',
          manual: `Es de código manual: el vigilante teclea ${codigo} en la app, en «Código manual».`,
          codigo: `Código del QR: ${codigo}`,
          qr: 'Imprime su QR y pégalo en el punto; el vigilante lo escanea con la app.',
        },
        en: {
          creado: `✅ Checkpoint «${cp.name}» created in the location «${p.ubicacion}» of ${ctx.org.name}.`,
          sinCodigo: 'You can see its code in the dashboard, in Checkpoints.',
          manual: `It uses a manual code: the guard types ${codigo} in the app, under «Manual code».`,
          codigo: `QR code: ${codigo}`,
          qr: 'Print its QR and stick it at the checkpoint; the guard scans it with the app.',
        },
        fr: {
          creado: `✅ Checkpoint «${cp.name}» créé sur le site «${p.ubicacion}» de ${ctx.org.name}.`,
          sinCodigo: 'Vous trouverez son code dans le tableau de bord, dans Checkpoints.',
          manual: `Il utilise un code manuel : l'agent saisit ${codigo} dans l'application, dans «Code manuel».`,
          codigo: `Code du QR : ${codigo}`,
          qr: "Imprimez son QR code et collez-le au point de contrôle ; l'agent le scanne avec l'application.",
        },
      });
      if (!codigo) return { texto: `${t.creado}\n\n${t.sinCodigo}` };
      if (metodo === 'manual_code') return { texto: `${t.creado}\n\n${t.manual}` };
      return {
        texto: `${t.creado} ${t.codigo}\n\n${t.qr}`,
        imagen: await checkpointQrImage({ code: codigo, name: cp.name }),
      };
    },
  });
}

// ---------------------------------------------------------------------------
// edit_checkpoint
// ---------------------------------------------------------------------------

const editCheckpointParams = {
  checkpoint: z.string().trim().min(1).describe('Nombre actual del checkpoint'),
  ubicacion: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe('Ubicación del checkpoint, si hay varios con ese nombre. OMÍTELO si no hace falta.'),
  nombre: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .optional()
    .describe('Nombre nuevo. OMÍTELO si no cambia.'),
  descripcion: z
    .string()
    .trim()
    .min(1)
    .max(1000)
    .optional()
    .describe('Descripción nueva. OMÍTELO si no cambia.'),
  checkpoint_id: z.string().optional().describe(INTERNO),
};

export function editCheckpoint({ gateway }: ActionEnv): ActionDefinition {
  return defineBotAction({
    nombre: 'edit_checkpoint',
    tool: 'proponer_editar_checkpoint',
    descripcion:
      'Prepara cambiar el nombre y/o la descripción de un checkpoint. NO lo cambia: le envía al cliente un resumen con un botón para confirmarlo. ' +
      'NO sirve para cambiar el código ni el método de verificación (QR, código manual, NFC): con escaneos no se pueden cambiar; ' +
      'para eso se archiva y se crea un sucesor desde el panel. El QR impreso sigue valiendo tras renombrarlo.',
    params: editCheckpointParams,
    rolMinimo: 'EDITOR',
    async preparar(ctx, p) {
      if (!p.nombre && !p.descripcion)
        return {
          error: 'Falta qué cambiar: el nombre nuevo o la descripción. Pregúntaselo al usuario.',
        };
      const { items } = await gateway.listCheckpoints(ctx.org.orgId, ctx.token);
      const r = resolverCheckpoint(items, p.checkpoint, p.ubicacion);
      if ('error' in r) return r;
      return {
        params: {
          ...p,
          checkpoint: r.item.name,
          ubicacion: r.item.locationName,
          checkpoint_id: r.item.id,
        },
      };
    },
    resumen(p, { idioma, organizacion }) {
      const t = segunIdioma(idioma, {
        es: { nombre: 'nombre', descripcion: 'descripción' },
        en: { nombre: 'name', descripcion: 'description' },
        fr: { nombre: 'nom', descripcion: 'description' },
      });
      const cambios = [
        ...(p.nombre ? [`${t.nombre} → «${p.nombre}»`] : []),
        ...(p.descripcion ? [`${t.descripcion} → «${p.descripcion}»`] : []),
      ].join('; ');
      return segunIdioma(idioma, {
        es:
          `Cambiar el checkpoint «${p.checkpoint}» de la ubicación «${p.ubicacion}» de ${organizacion}: ${cambios}. ` +
          'Su código y su método de verificación no cambian (el QR impreso sigue valiendo).',
        en:
          `Change the checkpoint «${p.checkpoint}» in the location «${p.ubicacion}» of ${organizacion}: ${cambios}. ` +
          'Its code and verification method stay the same (the printed QR still works).',
        fr:
          `Modifier le checkpoint «${p.checkpoint}» du site «${p.ubicacion}» de ${organizacion} : ${cambios}. ` +
          'Son code et sa méthode de vérification ne changent pas (le QR code imprimé reste valable).',
      });
    },
    async ejecutar(ctx, p) {
      if (!p.checkpoint_id)
        throw new Error('edit_checkpoint sin checkpoint_id (no pasó por preparar)');
      await gateway.updateCheckpoint(
        {
          id: p.checkpoint_id,
          ...(p.nombre ? { name: p.nombre } : {}),
          ...(p.descripcion ? { description: p.descripcion } : {}),
        },
        ctx.token
      );
      const nombre = p.nombre ?? p.checkpoint;
      return {
        texto: segunIdioma(ctx.language, {
          es: `✅ Checkpoint «${nombre}» actualizado en la ubicación «${p.ubicacion}» de ${ctx.org.name}.`,
          en: `✅ Checkpoint «${nombre}» updated in the location «${p.ubicacion}» of ${ctx.org.name}.`,
          fr: `✅ Checkpoint «${nombre}» mis à jour sur le site «${p.ubicacion}» de ${ctx.org.name}.`,
        }),
      };
    },
  });
}
