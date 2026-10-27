import { z } from 'zod';
import { segunIdioma } from '../domain/language.js';
import { normalizeName } from '../domain/resolve-by-name.js';
import { ubicacionPedida } from './support/elegir-ubicacion.js';
import { INTERNO } from './support/shared.js';
import { defineBotAction, type ActionDefinition, type ActionEnv } from './types.js';

/**
 * Editar y borrar una ubicación. Los ids
 * (ubicación, organización) salen SIEMPRE de la sesión y de `listLocations` de
 * esa organización, nunca de lo que diga el modelo.
 */

// ---------------------------------------------------------------------------
// edit_location
// ---------------------------------------------------------------------------

const editLocationParams = {
  ubicacion: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe('Nombre actual de la ubicación. Pregúntalo solo si tiene varias.'),
  nombre: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .optional()
    .describe('Nombre nuevo. OMÍTELO si no cambia.'),
  direccion: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .optional()
    .describe('Dirección nueva. OMÍTELO si no cambia (no se puede dejar vacía).'),
  ubicacion_id: z.string().optional().describe(INTERNO),
  direccion_actual: z.string().optional().describe(INTERNO),
};

export function editLocation({ gateway }: ActionEnv): ActionDefinition {
  return defineBotAction({
    nombre: 'edit_location',
    tool: 'proponer_editar_ubicacion',
    descripcion:
      'Prepara cambiar el nombre y/o la dirección de una ubicación de la organización. NO lo cambia: le envía al cliente un resumen ' +
      'con un botón para confirmarlo. Sus checkpoints, rutas y escaneos no cambian.',
    params: editLocationParams,
    rolMinimo: 'EDITOR',
    async preparar(ctx, p) {
      if (!p.nombre && !p.direccion)
        return {
          error: 'Falta qué cambiar: el nombre nuevo o la dirección. Pregúntaselo al usuario.',
        };
      const ubicaciones = await gateway.listLocations(ctx.org.orgId, ctx.token);
      const u = ubicacionPedida(ubicaciones, p.ubicacion, 'cambiar');
      if ('error' in u) return u;
      const loc = u.item;
      // El backend no exige nombres únicos: dos ubicaciones iguales ya no se pueden elegir por su nombre.
      const otra =
        p.nombre &&
        ubicaciones.find(
          (l) => l.id !== loc.id && normalizeName(l.name) === normalizeName(p.nombre!)
        );
      if (otra)
        return {
          error: `Ya hay otra ubicación que se llama «${otra.name}»: pide al usuario un nombre distinto.`,
        };
      // Solo viaja lo que cambia de verdad.
      const nombre = p.nombre && p.nombre !== loc.name ? p.nombre : undefined;
      const direccion =
        p.direccion && p.direccion !== (loc.address ?? '').trim() ? p.direccion : undefined;
      if (!nombre && !direccion)
        return {
          error: `La ubicación «${loc.name}» ya tiene ese nombre y esa dirección: no hay nada que cambiar.`,
        };
      return {
        params: {
          ubicacion: loc.name,
          ubicacion_id: loc.id,
          nombre,
          direccion,
          direccion_actual: direccion ? (loc.address ?? undefined) : undefined,
        },
      };
    },
    resumen(p, { idioma, organizacion }) {
      const t = segunIdioma(idioma, {
        es: { nombre: 'nombre', direccion: 'dirección', antes: 'antes' },
        en: { nombre: 'name', direccion: 'address', antes: 'was' },
        fr: { nombre: 'nom', direccion: 'adresse', antes: 'avant' },
      });
      const cambios = [
        ...(p.nombre ? [`${t.nombre} → «${p.nombre}»`] : []),
        ...(p.direccion
          ? [
              `${t.direccion} → «${p.direccion}»${p.direccion_actual ? ` (${t.antes} «${p.direccion_actual}»)` : ''}`,
            ]
          : []),
      ].join('; ');
      return segunIdioma(idioma, {
        es: `Cambiar la ubicación «${p.ubicacion}» de ${organizacion}: ${cambios}.`,
        en: `Change the location «${p.ubicacion}» of ${organizacion}: ${cambios}.`,
        fr: `Modifier le site «${p.ubicacion}» de ${organizacion} : ${cambios}.`,
      });
    },
    async ejecutar(ctx, p) {
      if (!p.ubicacion_id) throw new Error('edit_location sin ubicacion_id (no pasó por preparar)');
      await gateway.updateLocation(
        {
          id: p.ubicacion_id,
          ...(p.nombre ? { name: p.nombre } : {}),
          ...(p.direccion ? { address: p.direccion } : {}),
        },
        ctx.token
      );
      const nombre = p.nombre ?? p.ubicacion;
      return {
        texto: segunIdioma(ctx.language, {
          es: `✅ Ubicación «${nombre}» de ${ctx.org.name} actualizada.`,
          en: `✅ Location «${nombre}» of ${ctx.org.name} updated.`,
          fr: `✅ Site «${nombre}» de ${ctx.org.name} mis à jour.`,
        }),
      };
    },
  });
}

// ---------------------------------------------------------------------------
// delete_location
// ---------------------------------------------------------------------------

const deleteLocationParams = {
  ubicacion: z.string().trim().min(1).describe('Nombre de la ubicación a borrar'),
  ubicacion_id: z.string().optional().describe(INTERNO),
  checkpoints: z.number().int().nonnegative().optional().describe(INTERNO),
  rutas: z.number().int().nonnegative().optional().describe(INTERNO),
};

/** «3 checkpoints», «1 ruta»… (el sustantivo ya en el idioma). */
const cuantos = (n: number, singular: string, plural: string): string =>
  `${n} ${n === 1 ? singular : plural}`;

export function deleteLocation({ gateway }: ActionEnv): ActionDefinition {
  return defineBotAction({
    nombre: 'delete_location',
    tool: 'proponer_borrar_ubicacion',
    descripcion:
      'Prepara BORRAR una ubicación. NO la borra: le envía al cliente un resumen con un botón para confirmarlo. Es IRREVERSIBLE: ' +
      'borra todos sus checkpoints (también los ya escaneados), sus rutas y sus rondas, su control de acceso y los permisos de esa ' +
      'ubicación; los escaneos se conservan. No se puede borrar la única ubicación de la organización. Si el cliente solo quiere que ' +
      'sus checkpoints dejen de contar para el plan, propón antes archivarlos (proponer_archivar_checkpoint), que no borra nada.',
    params: deleteLocationParams,
    rolMinimo: 'ADMIN',
    // Un admin de ubicación no basta: el backend podría dejarle borrar otras ubicaciones de la organización.
    rolDeOrganizacion: true,
    async preparar(ctx, p) {
      const ubicaciones = await gateway.listLocations(ctx.org.orgId, ctx.token);
      const u = ubicacionPedida(ubicaciones, p.ubicacion, 'borrar', false);
      if ('error' in u) return u;
      const loc = u.item;
      if (ubicaciones.length <= 1) {
        return {
          error:
            `«${loc.name}» es la única ubicación de «${ctx.org.name}»: no se puede borrar. ` +
            'Si quiere cambiarle el nombre o la dirección, propón proponer_editar_ubicacion.',
        };
      }
      // La cuenta es informativa (listas capadas o ubicaciones que fallan pueden dejarla corta); el aviso de borrado no depende de ella.
      const [activos, archivados, rutas] = await Promise.all([
        gateway.listCheckpoints(ctx.org.orgId, ctx.token),
        gateway.listArchivedCheckpoints(ctx.org.orgId, ctx.token),
        gateway.listRoutes(ctx.org.orgId, ctx.token),
      ]);
      const checkpoints = [...activos.items, ...archivados.items].filter(
        (c) => c.locationId === loc.id
      ).length;
      return {
        params: {
          ubicacion: loc.name,
          ubicacion_id: loc.id,
          checkpoints,
          rutas: rutas.items.filter((r) => r.locationId === loc.id).length,
        },
      };
    },
    resumen(p, { idioma, organizacion }) {
      const cps = p.checkpoints ?? 0;
      const rutas = p.rutas ?? 0;
      return segunIdioma(idioma, {
        es:
          `Borrar la ubicación «${p.ubicacion}» de ${organizacion}.\n` +
          `⚠️ SE BORRARÁN TODOS SUS CHECKPOINTS (${cps}, TAMBIÉN LOS YA ESCANEADOS), SUS RUTAS (${rutas}) Y SUS RONDAS, SU CONTROL DE ACCESO ` +
          'Y LOS PERMISOS DE ESA UBICACIÓN. NO SE PUEDE DESHACER. Los escaneos se conservan.',
        en:
          `Delete the location «${p.ubicacion}» of ${organizacion}.\n` +
          `⚠️ ALL ITS CHECKPOINTS (${cps}, INCLUDING THOSE ALREADY SCANNED), ITS ROUTES (${rutas}) AND THEIR ROUNDS, ITS ACCESS CONTROL ` +
          'AND THE PERMISSIONS FOR THAT LOCATION WILL BE DELETED. THIS CANNOT BE UNDONE. Scans are kept.',
        fr:
          `Supprimer le site «${p.ubicacion}» de ${organizacion}.\n` +
          `⚠️ TOUS SES CHECKPOINTS (${cps}, Y COMPRIS CEUX DÉJÀ SCANNÉS), SES PARCOURS (${rutas}) ET LEURS RONDES, SON CONTRÔLE D'ACCÈS ` +
          "ET LES AUTORISATIONS DE CE SITE SERONT SUPPRIMÉS. C'EST IRRÉVERSIBLE. Les scans sont conservés.",
      });
    },
    async ejecutar(ctx, p) {
      if (!p.ubicacion_id)
        throw new Error('delete_location sin ubicacion_id (no pasó por preparar)');
      await gateway.deleteLocation(p.ubicacion_id, ctx.token);
      const cps = p.checkpoints ?? 0;
      const rutas = p.rutas ?? 0;
      return {
        texto: segunIdioma(ctx.language, {
          es: `✅ Ubicación «${p.ubicacion}» borrada de ${ctx.org.name}, junto con ${cuantos(cps, 'checkpoint', 'checkpoints')} y ${cuantos(rutas, 'ruta', 'rutas')}. Los escaneos se conservan.`,
          en: `✅ Location «${p.ubicacion}» deleted from ${ctx.org.name}, along with ${cuantos(cps, 'checkpoint', 'checkpoints')} and ${cuantos(rutas, 'route', 'routes')}. Scans are kept.`,
          fr: `✅ Site «${p.ubicacion}» supprimé de ${ctx.org.name}, avec ${cuantos(cps, 'checkpoint', 'checkpoints')} et ${cuantos(rutas, 'parcours', 'parcours')}. Les scans sont conservés.`,
        }),
      };
    },
  });
}
