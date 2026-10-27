import { z } from 'zod';
import { segunIdioma } from '../domain/language.js';
import { ambito } from '../reads/support/roles.js';
import { INTERNO, quien, sinPlazaDeGestor } from './support/shared.js';
import {
  accesoA,
  etiquetaRol,
  proteccionAlEjecutar,
  proteccionAlPreparar,
  resolverAcceso,
} from './support/user-access.js';
import { defineBotAction, ROLES, type ActionDefinition, type ActionEnv } from './types.js';

/**
 * Cambiar el rol y quitar el acceso a quien YA está en el panel de la
 * organización (lo de invitar a alguien nuevo es `invite_user`).
 *
 * La persona y el `userRoleId` salen SOLO de `listOrgUsers` de la organización
 * de la sesión, nunca de lo que diga el modelo. El backend no protege a nadie de
 * sí mismo ni impide dejar la organización sin Admin: esas dos protecciones son
 * de la acción, en `preparar` y otra vez en `ejecutar` (con la lista del momento: en
 * un lote, o con la propuesta un rato esperando, la de antes ya no vale).
 */

const usuarioParam = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .describe('Nombre o email de la persona, tal como aparece en consultar_usuarios_y_roles');
const accesoParam = z
  .string()
  .trim()
  .min(1)
  .optional()
  .describe(
    'SOLO si tiene varios accesos (organización y ubicaciones): cuál, por su número en la lista que te dé el bot, el nombre de la ubicación o «organización». OMÍTELO si tiene uno.'
  );

// ---------------------------------------------------------------------------
// change_user_role
// ---------------------------------------------------------------------------

const changeRoleParams = {
  usuario: usuarioParam,
  rol: z
    .enum(ROLES)
    .describe(
      'Rol nuevo: VIEWER (solo ver; no ocupa plaza de gestor), EDITOR (gestiona checkpoints, rutas y vigilantes) o ADMIN (todo, también usuarios y licencia)'
    ),
  acceso: accesoParam,
  usuario_id: z.string().optional().describe(INTERNO),
  email: z.string().optional().describe(INTERNO),
  rol_id: z.string().optional().describe(INTERNO),
  rol_actual: z.string().optional().describe(INTERNO),
  ubicacion: z.string().optional().describe(INTERNO),
};

export function changeUserRole(env: ActionEnv): ActionDefinition {
  const { gateway } = env;
  return defineBotAction({
    nombre: 'change_user_role',
    tool: 'proponer_cambiar_rol_usuario',
    descripcion:
      'Prepara cambiar el rol (VIEWER, EDITOR o ADMIN) de una persona que YA tiene acceso al panel de la organización. NO lo cambia: ' +
      'le envía al cliente un resumen con un botón para confirmarlo. Hace falta su nombre o email y el rol nuevo; si tiene varios ' +
      'accesos (organización y ubicaciones), el bot pregunta cuál. Para alguien que aún no tiene acceso, usa proponer_invitar_usuario. ' +
      'Nadie puede cambiar su propio rol, y la organización no puede quedarse sin ningún Admin de organización.',
    params: changeRoleParams,
    rolMinimo: 'ADMIN',
    // Como invitar: un admin de ubicación no gestiona los usuarios de la organización.
    rolDeOrganizacion: true,
    async preparar(ctx, p) {
      const r = await resolverAcceso(gateway, ctx, p, 'cambiar');
      if ('error' in r) return r;
      const { persona, acceso, usuarios } = r;
      const proteccion = proteccionAlPreparar(ctx, usuarios, persona, acceso, p.rol !== 'ADMIN');
      if (proteccion) return { error: proteccion };
      if (acceso.rol === p.rol) {
        return {
          error: `${persona.nombre} ya es ${etiquetaRol(p.rol, 'es')} ${ambito('es', acceso.ubicacion)}: no hay nada que cambiar.`,
        };
      }
      // Igual que la API: solo cuenta pasar de no ocupar plaza de gestor a ocuparla.
      if (acceso.rol === 'VIEWER' && p.rol !== 'VIEWER') {
        const lleno = await sinPlazaDeGestor(env, ctx, {
          conPlan: 'puede seguir como VIEWER, quitar el rol de gestor a otra persona',
          sinPlan: 'puede seguir como VIEWER o quitar el rol de gestor a otra persona',
        });
        if (lleno) return { error: lleno };
      }
      return {
        params: {
          usuario: persona.nombre,
          rol: p.rol,
          usuario_id: persona.id,
          email: persona.email.trim(),
          rol_id: acceso.id,
          rol_actual: acceso.rol,
          ubicacion: acceso.ubicacion,
        },
      };
    },
    resumen(p, { idioma, organizacion }) {
      const cambio = `${etiquetaRol(p.rol_actual, idioma)} → ${etiquetaRol(p.rol, idioma)} (${accesoA(idioma, p.ubicacion)})`;
      return segunIdioma(idioma, {
        es: `Cambiar el rol de ${quien(p)} en ${organizacion}: ${cambio}.`,
        en: `Change the role of ${quien(p)} in ${organizacion}: ${cambio}.`,
        fr: `Changer le rôle de ${quien(p)} dans ${organizacion} : ${cambio}.`,
      });
    },
    async ejecutar(ctx, p) {
      const rolId = await proteccionAlEjecutar(gateway, ctx, p, p.rol !== 'ADMIN');
      await gateway.updateUserRole({ userRoleId: rolId, roleType: p.rol }, ctx.token);
      const rol = etiquetaRol(p.rol, ctx.language);
      const donde = ambito(ctx.language, p.ubicacion);
      return {
        texto: segunIdioma(ctx.language, {
          es: `✅ ${quien(p)} ahora es ${rol} ${donde} en ${ctx.org.name}. Si tenía el panel abierto, puede que tenga que volver a entrar para verlo.`,
          en: `✅ ${quien(p)} is now ${rol} ${donde} in ${ctx.org.name}. If they had the dashboard open, they may need to log in again to see it.`,
          fr: `✅ ${quien(p)} est maintenant ${rol} ${donde} dans ${ctx.org.name}. Si cette personne avait le tableau de bord ouvert, elle devra peut-être se reconnecter pour le voir.`,
        }),
      };
    },
  });
}

// ---------------------------------------------------------------------------
// remove_user_access
// ---------------------------------------------------------------------------

const removeAccessParams = {
  usuario: usuarioParam,
  acceso: accesoParam,
  usuario_id: z.string().optional().describe(INTERNO),
  email: z.string().optional().describe(INTERNO),
  rol_id: z.string().optional().describe(INTERNO),
  rol_actual: z.string().optional().describe(INTERNO),
  ubicacion: z.string().optional().describe(INTERNO),
  unico: z.boolean().optional().describe(INTERNO),
};

export function removeUserAccess({ gateway }: ActionEnv): ActionDefinition {
  return defineBotAction({
    nombre: 'remove_user_access',
    tool: 'proponer_quitar_acceso_usuario',
    descripcion:
      'Prepara quitarle a una persona un acceso al panel de la organización (su rol de organización o el de una ubicación). NO lo ' +
      'quita: le envía al cliente un resumen con un botón para confirmarlo. Su cuenta de PatrolTech no se borra y se puede deshacer ' +
      'volviendo a invitarla (proponer_invitar_usuario). Si tiene varios accesos, el bot pregunta cuál; para quitárselos todos, propón ' +
      'uno por acceso en el mismo turno. Nadie puede quitarse su propio acceso, y la organización no puede quedarse sin ningún Admin ' +
      'de organización. Para que vea menos sin echarla, propón mejor proponer_cambiar_rol_usuario a VIEWER.',
    params: removeAccessParams,
    rolMinimo: 'ADMIN',
    rolDeOrganizacion: true,
    async preparar(ctx, p) {
      const r = await resolverAcceso(gateway, ctx, p, 'quitar');
      if ('error' in r) return r;
      const { persona, acceso, accesos, usuarios } = r;
      const proteccion = proteccionAlPreparar(ctx, usuarios, persona, acceso, true);
      if (proteccion) return { error: proteccion };
      return {
        params: {
          usuario: persona.nombre,
          usuario_id: persona.id,
          email: persona.email.trim(),
          rol_id: acceso.id,
          rol_actual: acceso.rol,
          ubicacion: acceso.ubicacion,
          unico: accesos.length === 1,
        },
      };
    },
    resumen(p, { idioma, organizacion }) {
      const rol = etiquetaRol(p.rol_actual, idioma);
      const donde = ambito(idioma, p.ubicacion);
      return segunIdioma(idioma, {
        es:
          `Quitar a ${quien(p)} el acceso como ${rol} ${donde} en ${organizacion}. ` +
          (p.unico
            ? `Era su único acceso: dejará de poder entrar en el panel de ${organizacion} (su cuenta de PatrolTech no se borra). `
            : `Conserva sus otros accesos en ${organizacion}, salvo que también se los quites en esta misma confirmación. `) +
          'Se puede deshacer: basta con volver a invitarla.',
        en:
          `Remove ${quien(p)}'s access as ${rol} ${donde} in ${organizacion}. ` +
          (p.unico
            ? `It's their only access: they won't be able to log in to the ${organizacion} dashboard (their PatrolTech account isn't deleted). `
            : `They keep their other access in ${organizacion}, unless you also remove it in this same confirmation. `) +
          'This can be undone: just invite them again.',
        fr:
          `Retirer à ${quien(p)} l'accès en tant que ${rol} ${donde} dans ${organizacion}. ` +
          (p.unico
            ? `C'était son seul accès : cette personne ne pourra plus se connecter au tableau de bord de ${organizacion} (son compte PatrolTech n'est pas supprimé). `
            : `Cette personne conserve ses autres accès dans ${organizacion}, sauf si vous les lui retirez aussi dans cette même confirmation. `) +
          "C'est réversible : il suffit de l'inviter à nouveau.",
      });
    },
    async ejecutar(ctx, p) {
      const rolId = await proteccionAlEjecutar(gateway, ctx, p, true);
      await gateway.deleteUserRole(rolId, ctx.token);
      const rol = etiquetaRol(p.rol_actual, ctx.language);
      const donde = ambito(ctx.language, p.ubicacion);
      return {
        texto: segunIdioma(ctx.language, {
          es: `✅ ${quien(p)} ya no tiene acceso como ${rol} ${donde} en ${ctx.org.name}. Si hace falta, se le puede volver a invitar.`,
          en: `✅ ${quien(p)} no longer has access as ${rol} ${donde} in ${ctx.org.name}. If needed, they can be invited again.`,
          fr: `✅ ${quien(p)} n'a plus accès en tant que ${rol} ${donde} dans ${ctx.org.name}. Si besoin, cette personne peut être invitée à nouveau.`,
        }),
      };
    },
  });
}
