import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { PatrolTechApiError } from '../domain/backend-errors.js';
import { checkpointQrImage } from '../domain/qr-image.js';
import { guardAppMessage } from '../domain/guard-app-message.js';
import { segunIdioma } from '../domain/language.js';
import type { CreatedPatroller } from '../gateway/index.js';
import { INTERNO, maybeApplied, resolver } from './support/shared.js';
import { defineBotAction, type ActionDefinition, type ActionEnv } from './types.js';

/** Alta de un vigilante y cambiar su nombre o teléfono. */

// ---------------------------------------------------------------------------
// create_patroller
// ---------------------------------------------------------------------------

const createPatrollerParams = {
  nombre: z.string().trim().min(1).describe('Nombre del vigilante'),
  telefono: z
    .string()
    .trim()
    .min(1)
    .max(30)
    .optional()
    .describe('Teléfono del vigilante, solo si el usuario lo da (no lo pidas)'),
  identificador: z.string().optional().describe(INTERNO),
};

/** Identificador del vigilante: 8 hex en mayúsculas, el mismo formato que genera la API. */
export function newPatrollerIdentifier(): string {
  return randomBytes(4).toString('hex').toUpperCase();
}

export function createPatroller({ gateway, urls }: ActionEnv): ActionDefinition {
  return defineBotAction({
    nombre: 'create_patroller',
    tool: 'proponer_crear_vigilante',
    descripcion:
      'Prepara el alta de un vigilante (patrullero) en la organización. NO lo crea: le envía al cliente un resumen con un botón ' +
      'para confirmarlo; al confirmar se crea y el cliente recibe el enlace personal de la app de ese vigilante y su QR. ' +
      'Úsala cuando el cliente quiera dar de alta o añadir un vigilante. Solo hace falta el nombre; el teléfono del vigilante es opcional.',
    params: createPatrollerParams,
    rolMinimo: 'EDITOR',
    rolDeOrganizacion: true,
    async preparar(_ctx, p) {
      // El bot fija el identificador antes de confirmar: si el alta responde con
      // error pero se hizo, se recupera por él (es único en todo el sistema).
      const identificador = newPatrollerIdentifier();
      return { params: { ...p, identificador }, idempotencyKey: identificador };
    },
    resumen(p, { idioma, organizacion }) {
      return segunIdioma(idioma, {
        es: `Crear el vigilante «${p.nombre}»${p.telefono ? ` (teléfono ${p.telefono})` : ''} en ${organizacion}. Después te daré su enlace personal de la app.`,
        en: `Create the guard «${p.nombre}»${p.telefono ? ` (phone ${p.telefono})` : ''} in ${organizacion}. Then I'll give you their personal app link.`,
        fr: `Créer l'agent «${p.nombre}»${p.telefono ? ` (téléphone ${p.telefono})` : ''} dans ${organizacion}. Ensuite, je vous donnerai son lien personnel vers l'application.`,
      });
    },
    async ejecutar(ctx, p) {
      const identifier = p.identificador ?? ctx.idempotencyKey;
      if (!identifier) throw new Error('create_patroller sin identificador (no pasó por preparar)');
      let v: CreatedPatroller;
      try {
        v = await gateway.createPatroller(
          {
            organizationId: ctx.org.orgId,
            name: p.nombre,
            identifier,
            ...(p.telefono ? { phone: p.telefono } : {}),
          },
          ctx.token
        );
      } catch (err) {
        // El identificador duplicado (un reintento de un alta que sí se hizo) es un 409
        // PATROLLER_IDENTIFIER_TAKEN; un backend anterior respondía 500 (sale como dudoso).
        const dudoso =
          maybeApplied(err) || (err instanceof PatrolTechApiError && err.status === 409);
        const recovered = dudoso
          ? await gateway.getPatrollerByIdentifier(identifier, ctx.token).catch(() => null)
          : null;
        if (!recovered || recovered.organizationId !== ctx.org.orgId) throw err;
        v = recovered;
      }

      const link = `${urls.app}/${ctx.org.orgId}/${v.identifier}`;
      // El bot no puede mandárselo al vigilante: le deja al admin el mensaje listo para reenviar.
      const mensaje = guardAppMessage(v.name, link, ctx.language);
      const texto = segunIdioma(ctx.language, {
        es:
          `✅ Vigilante «${v.name}» creado en ${ctx.org.name}.\n\nSu enlace personal de la app: ${link}\n\n` +
          `⚠️ Ese enlace permite entrar en la app como ${v.name} sin contraseña: reenvíaselo solo a esa persona, nunca a un grupo.\n\n` +
          `Mensaje listo para reenviar a ${v.name} por WhatsApp o email:\n\n${mensaje}`,
        en:
          `✅ Guard «${v.name}» created in ${ctx.org.name}.\n\nTheir personal app link: ${link}\n\n` +
          `⚠️ This link lets anyone open the app as ${v.name} without a password: forward it only to them, never to a group.\n\n` +
          `Message ready to forward to ${v.name} by WhatsApp or email:\n\n${mensaje}`,
        fr:
          `✅ Agent «${v.name}» créé dans ${ctx.org.name}.\n\nSon lien personnel vers l'application : ${link}\n\n` +
          `⚠️ Ce lien permet d'ouvrir l'application en tant que ${v.name} sans mot de passe : transférez-le uniquement à cette personne, jamais à un groupe.\n\n` +
          `Message prêt à transférer à ${v.name} par WhatsApp ou e-mail :\n\n${mensaje}`,
      });
      // El mismo generador que el QR de un checkpoint (codifica cualquier texto; el pie es nombre + enlace).
      return { texto, imagen: await checkpointQrImage({ code: link, name: v.name }) };
    },
  });
}

// ---------------------------------------------------------------------------
// rename_patroller
// ---------------------------------------------------------------------------

const editPatrollerParams = {
  vigilante: z.string().trim().min(1).describe('Nombre actual del vigilante'),
  nombre: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .optional()
    .describe('Nombre nuevo. OMÍTELO si no cambia.'),
  telefono: z
    .string()
    .trim()
    .min(1)
    .max(30)
    .optional()
    .describe('Teléfono nuevo del vigilante. OMÍTELO si no cambia.'),
  vigilante_id: z.string().optional().describe(INTERNO),
};

export function editPatroller({ gateway }: ActionEnv): ActionDefinition {
  return defineBotAction({
    nombre: 'rename_patroller',
    tool: 'proponer_editar_vigilante',
    descripcion:
      'Prepara cambiar el nombre y/o el teléfono de un vigilante (patrullero). NO lo cambia: le envía al cliente un resumen con un botón para ' +
      'confirmarlo. Su identificador y su enlace de la app no cambian (no se pueden cambiar).',
    params: editPatrollerParams,
    rolMinimo: 'EDITOR',
    rolDeOrganizacion: true,
    async preparar(ctx, p) {
      if (!p.nombre && !p.telefono)
        return {
          error: 'Falta qué cambiar: el nombre nuevo o el teléfono. Pregúntaselo al usuario.',
        };
      const { items } = await gateway.listPatrollers(ctx.org.orgId, ctx.token);
      const r = resolver(p.vigilante, items, (v) => v.name, ['el vigilante', 'vigilantes'], {
        idOf: (v) => v.identifier,
      });
      if ('error' in r) return r;
      return { params: { ...p, vigilante: r.item.name, vigilante_id: r.item.id } };
    },
    resumen(p, { idioma, organizacion }) {
      const t = segunIdioma(idioma, {
        es: { nombre: 'nombre', telefono: 'teléfono' },
        en: { nombre: 'name', telefono: 'phone' },
        fr: { nombre: 'nom', telefono: 'téléphone' },
      });
      const cambios = [
        ...(p.nombre ? [`${t.nombre} → «${p.nombre}»`] : []),
        ...(p.telefono ? [`${t.telefono} → ${p.telefono}`] : []),
      ].join('; ');
      return segunIdioma(idioma, {
        es: `Cambiar el vigilante «${p.vigilante}» de ${organizacion}: ${cambios}. Su enlace de la app no cambia.`,
        en: `Change the guard «${p.vigilante}» of ${organizacion}: ${cambios}. Their app link stays the same.`,
        fr: `Modifier l'agent «${p.vigilante}» de ${organizacion} : ${cambios}. Son lien vers l'application ne change pas.`,
      });
    },
    async ejecutar(ctx, p) {
      if (!p.vigilante_id)
        throw new Error('rename_patroller sin vigilante_id (no pasó por preparar)');
      const v = await gateway.updatePatroller(
        {
          id: p.vigilante_id,
          ...(p.nombre ? { name: p.nombre } : {}),
          ...(p.telefono ? { phone: p.telefono } : {}),
        },
        ctx.token
      );
      const tel = (palabra: string) => (p.telefono ? `, ${palabra} ${p.telefono}` : '');
      return {
        texto: segunIdioma(ctx.language, {
          es: `✅ Vigilante actualizado en ${ctx.org.name}: «${v.name}»${tel('teléfono')}. Su enlace de la app sigue siendo el mismo.`,
          en: `✅ Guard updated in ${ctx.org.name}: «${v.name}»${tel('phone')}. Their app link stays the same.`,
          fr: `✅ Agent mis à jour dans ${ctx.org.name} : «${v.name}»${tel('téléphone')}. Son lien vers l'application reste le même.`,
        }),
      };
    },
  });
}
