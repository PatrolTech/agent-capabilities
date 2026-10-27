import { z } from 'zod';
import { segunIdioma } from '../domain/language.js';
import type { LocationRef, NewOrgUser } from '../gateway/index.js';
import { ambito, ROL_LABEL_ACCION } from '../reads/support/roles.js';
import { ubicacionPedida } from './support/elegir-ubicacion.js';
import { buscarPorEmail, INTERNO, sinPlazaDeGestor } from './support/shared.js';
import {
  defineBotAction,
  ROLES,
  type ActionDefinition,
  type ActionEnv,
  type RoleType,
} from './types.js';

/**
 * Invitar a una persona al panel. Cambiar el rol o quitar el acceso a
 * quien ya está va en `user-roles.ts`. La organización sale SIEMPRE de la sesión.
 */

// Validación de forma, no de entrega: la API no comprueba que el email exista y el correo de invitación dirá si llega.
// Sin `<>,;:()[]"` ni punto final: lo que se cuela al copiarlo de una frase («…es luis@acme.test.»).
const EMAIL_RE = /^[^\s@<>,;:()[\]"]+@[^\s@<>,;:()[\]"]+\.[^\s@<>,;:()[\]".]+$/;

const inviteParams = {
  nombre: z.string().trim().min(1).max(255).describe('Nombre de la persona'),
  email: z.string().trim().min(1).max(255).describe('Email con el que entrará al panel'),
  rol: z
    .enum(ROLES)
    .optional()
    .describe(
      'VIEWER (por defecto: solo ve la actividad; no ocupa plaza de gestor), EDITOR (gestiona checkpoints, rutas y vigilantes) o ' +
        'ADMIN (todo, también usuarios y licencia). Usa VIEWER salvo que el cliente pida otro.'
    ),
  ubicacion: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe(
      'SOLO si su acceso es a UNA ubicación: su nombre. OMÍTELO para toda la organización.'
    ),
  ubicacion_id: z.string().optional().describe(INTERNO),
};

export function inviteUser(env: ActionEnv): ActionDefinition {
  const { gateway, urls } = env;
  return defineBotAction({
    nombre: 'invite_user',
    tool: 'proponer_invitar_usuario',
    descripcion:
      'Prepara invitar a una persona al panel (dashboard) de la organización, con su propio usuario. NO la invita: le envía al cliente ' +
      'un resumen con un botón para confirmarlo. Hace falta su nombre y su email; el rol es VIEWER (solo ver) salvo que pida otro, y el ' +
      'acceso es a toda la organización salvo que diga una ubicación. Al confirmar le llega un correo para crear su contraseña.',
    params: inviteParams,
    rolMinimo: 'ADMIN',
    rolDeOrganizacion: true,
    async preparar(ctx, p) {
      const email = p.email.trim().toLowerCase();
      if (!EMAIL_RE.test(email))
        return { error: `«${p.email}» no parece un email válido: pídeselo de nuevo al usuario.` };
      const rol: RoleType = p.rol ?? 'VIEWER';

      let ubicacion: LocationRef | undefined;
      if (p.ubicacion) {
        // El backend no comprueba que la ubicación sea de la organización: el id sale SOLO de esta lista.
        const u = ubicacionPedida(
          await gateway.listLocations(ctx.org.orgId, ctx.token),
          p.ubicacion,
          'darle',
          false
        );
        if ('error' in u) return u;
        ubicacion = u.item;
      }

      // Con un rol ya en ese mismo ámbito, el backend rechaza la invitación (rol único por ámbito).
      const scopeId = ubicacion?.id ?? ctx.org.orgId;
      const existente = buscarPorEmail(await gateway.listOrgUsers(ctx.org.orgId, ctx.token), email);
      const deOrganizacion = existente?.roles.find(
        (r) => r.ambito === 'ORGANIZATION' && r.scopeId === ctx.org.orgId
      );
      if (existente && deOrganizacion && ubicacion) {
        // El backend la aceptaría (otro ámbito), pero ya ve esa ubicación: un rol de ubicación encima solo confunde.
        return {
          error:
            `${existente.nombre} (${email}) ya tiene acceso a toda la organización como ${deOrganizacion.rol}, también a «${ubicacion.name}». ` +
            'No hace falta invitarla; si quiere cambiarle el rol, propón proponer_cambiar_rol_usuario.',
        };
      }
      const yaTiene = existente?.roles.find(
        (r) => r.scopeId === scopeId && r.ambito === (ubicacion ? 'LOCATION' : 'ORGANIZATION')
      );
      if (existente && yaTiene) {
        return {
          error:
            `${existente.nombre} (${email}) ya tiene acceso como ${yaTiene.rol} ${ambito('es', ubicacion?.name)}. ` +
            'No hace falta invitarla; si quiere cambiarle el rol, propón proponer_cambiar_rol_usuario.',
        };
      }

      // Después de «ya tiene acceso»: a quien ya está, el plan lleno no le afecta.
      if (rol !== 'VIEWER') {
        // Anticipa el 402 USER_LIMIT_REACHED: un VIEWER nunca ocupa asiento de gestor.
        const lleno = await sinPlazaDeGestor(env, ctx, {
          conPlan: 'ofrécele invitarla como VIEWER (solo ver), que no ocupa plaza,',
          sinPlan: 'ofrécele invitarla como VIEWER (solo ver), que no ocupa plaza',
        });
        if (lleno) return { error: lleno };
      }

      // El backend busca la cuenta por el email EXACTO: con otra capitalización crearía una segunda cuenta.
      const emailCuenta = existente?.email.trim() ?? email;
      return {
        params: {
          nombre: p.nombre,
          email: emailCuenta,
          rol,
          ubicacion: ubicacion?.name,
          ubicacion_id: ubicacion?.id,
        },
      };
    },
    resumen(p, { idioma, organizacion }) {
      const rol = ROL_LABEL_ACCION[p.rol ?? 'VIEWER'][idioma];
      const donde = ambito(idioma, p.ubicacion);
      return segunIdioma(idioma, {
        es: `Invitar a ${p.nombre} (${p.email}) al panel de ${organizacion} como ${rol} ${donde}. Si aún no tiene cuenta en PatrolTech, le llegará un correo para crear su contraseña.`,
        en: `Invite ${p.nombre} (${p.email}) to the ${organizacion} dashboard as ${rol} ${donde}. If they don't have a PatrolTech account yet, they'll get an email to set their password.`,
        fr: `Inviter ${p.nombre} (${p.email}) sur le tableau de bord de ${organizacion} en tant que ${rol} ${donde}. Si cette personne n'a pas encore de compte PatrolTech, elle recevra un e-mail pour créer son mot de passe.`,
      });
    },
    async ejecutar(ctx, p) {
      const rolType: RoleType = p.rol ?? 'VIEWER';
      // Whitelist explícita (nunca `id`); la organización es la de la sesión y la ubicación la resuelta en `preparar`.
      const input: NewOrgUser = {
        organizationId: ctx.org.orgId,
        name: p.nombre,
        email: p.email,
        roleType: rolType,
        roleScope: p.ubicacion_id ? 'LOCATION' : 'ORGANIZATION',
        ...(p.ubicacion_id ? { locationId: p.ubicacion_id } : {}),
      };
      const r = await gateway.inviteUser(input, ctx.token);
      const rol = ROL_LABEL_ACCION[rolType][ctx.language];
      const donde = ambito(ctx.language, p.ubicacion);
      const quien = `${p.nombre} (${p.email})`;
      if (!r.cuentaNueva) {
        return {
          texto: segunIdioma(ctx.language, {
            es: `✅ ${quien} ya tenía cuenta en PatrolTech: se le ha añadido el rol ${rol} ${donde} en ${ctx.org.name}. Le llega un aviso y entra en ${urls.dashboard} con su contraseña de siempre.`,
            en: `✅ ${quien} already had a PatrolTech account: they've been given the ${rol} role ${donde} in ${ctx.org.name}. They'll get a notice and log in at ${urls.dashboard} with their usual password.`,
            fr: `✅ ${quien} avait déjà un compte PatrolTech : le rôle ${rol} ${donde} lui a été ajouté dans ${ctx.org.name}. Cette personne reçoit un avis et se connecte sur ${urls.dashboard} avec son mot de passe habituel.`,
          }),
        };
      }
      if (!r.emailEnviado) {
        return {
          texto: segunIdioma(ctx.language, {
            es: `✅ ${quien} ya tiene acceso a ${ctx.org.name} como ${rol} ${donde}, pero el correo de invitación no se ha podido enviar. Que entre en ${urls.dashboard} y pulse «¿Olvidaste tu contraseña?» con ese email para crear su contraseña.`,
            en: `✅ ${quien} now has access to ${ctx.org.name} as ${rol} ${donde}, but the invitation email couldn't be sent. Ask them to go to ${urls.dashboard} and click «Forgot your password?» with that email to set their password.`,
            fr: `✅ ${quien} a maintenant accès à ${ctx.org.name} en tant que ${rol} ${donde}, mais l'e-mail d'invitation n'a pas pu être envoyé. Demandez-lui d'aller sur ${urls.dashboard} et de cliquer sur «Mot de passe oublié ?» avec cet e-mail pour créer son mot de passe.`,
          }),
        };
      }
      return {
        texto: segunIdioma(ctx.language, {
          es: `✅ Invitación enviada a ${quien} en ${ctx.org.name}, como ${rol} ${donde}. Le llega el correo «Te han invitado a PatrolTech» con un enlace para crear su contraseña; el enlace caduca en 72 h. Después entrará en ${urls.dashboard}.`,
          en: `✅ Invitation sent to ${quien} in ${ctx.org.name}, as ${rol} ${donde}. They'll get an invitation email from PatrolTech with a link to set their password; the link expires in 72 h. Then they log in at ${urls.dashboard}.`,
          fr: `✅ Invitation envoyée à ${quien} dans ${ctx.org.name}, en tant que ${rol} ${donde}. Cette personne reçoit un e-mail d'invitation de PatrolTech avec un lien pour créer son mot de passe ; le lien expire dans 72 h. Ensuite, elle se connecte sur ${urls.dashboard}.`,
        }),
      };
    },
  });
}
