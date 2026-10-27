import { segunIdioma, type FixedTextLanguage } from '../../domain/language.js';
import { normalizeName, resolveByName } from '../../domain/resolve-by-name.js';
import type { OrgUser, PatrolTechGateway } from '../../gateway/index.js';
import { ambito, ROL_LABEL_ACCION } from '../../reads/support/roles.js';
import { ROLES, type ActionContext, type ActionPrepareContext, type RoleType } from '../types.js';
import { buscarPorEmail, sinCambios } from './shared.js';

/**
 * Quién y qué acceso del panel tocan cambiar el rol y quitar el acceso, y sus dos
 * protecciones (uno mismo, el último Admin de organización) al proponer y al confirmar.
 */

/** Un rol de la persona en la organización, con el nombre de su ubicación si es de una. */
export interface Acceso {
  id: string;
  rol: string;
  /** undefined = de toda la organización. */
  ubicacion?: string;
}

export const esAdminDeOrganizacion = (
  r: { rol: string; ambito: string; scopeId: string },
  orgId: string
): boolean => r.rol === 'ADMIN' && r.ambito === 'ORGANIZATION' && r.scopeId === orgId;

/** «Viewer (solo ver)» o el rol tal cual si el backend trae uno que no conocemos. */
export const etiquetaRol = (rol: string | undefined, idioma: FixedTextLanguage): string =>
  (ROLES as readonly string[]).includes(rol ?? '')
    ? ROL_LABEL_ACCION[rol as RoleType][idioma]
    : (rol ?? '?');

/** La persona por email (exacto, sin mayúsculas) o por nombre, entre los usuarios de la organización. */
export function elegirPersona(
  usuarios: readonly OrgUser[],
  dicho: string
): { item: OrgUser } | { error: string } {
  const texto = dicho.trim();
  const noEsta =
    'Comprueba con consultar_usuarios_y_roles quién tiene acceso; si es alguien nuevo, propón proponer_invitar_usuario.';
  if (texto.includes('@')) {
    const u = buscarPorEmail(usuarios, texto);
    return u
      ? { item: u }
      : {
          error: `Nadie con el email «${texto}» tiene acceso al panel de la organización. ${noEsta}`,
        };
  }
  const r = resolveByName(texto, usuarios, (u) => u.nombre);
  if (r.kind === 'found') return { item: r.item };
  if (r.kind === 'ambiguous') {
    const opciones = r.matches.map((u) => `${u.nombre} (${u.email})`).join(', ');
    return {
      error: `Hay varias personas que casan con «${texto}»: ${opciones}. Pregunta al usuario cuál y pasa su email en \`usuario\`.`,
    };
  }
  return {
    error: `No encuentro a «${texto}» entre los usuarios del panel de la organización. ${noEsta}`,
  };
}

// Relleno en es/en/fr alrededor de «la organización»; lo que quede tiene que ser UNA de estas palabras.
export const RELLENO_ORGANIZACION = new Set([
  'el',
  'la',
  'l',
  'de',
  'del',
  'a',
  'al',
  'su',
  'toda',
  'todo',
  'acceso',
  'the',
  'whole',
  'entire',
  'of',
  'to',
  'access',
  'toute',
  'tout',
  'acces',
  'sa',
  'son',
]);
export const ORGANIZACION = new Set([
  'organizacion',
  'organization',
  'organisation',
  'empresa',
  'company',
  'entreprise',
  'org',
  'global',
]);

/** ¿Dice «el de toda la organización» y nada más? «Nave Global» o «Todas las naves» no. */
export function diceOrganizacion(texto: string): boolean {
  const palabras = normalizeName(texto)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w && !RELLENO_ORGANIZACION.has(w));
  return palabras.length === 1 && ORGANIZACION.has(palabras[0]);
}

/**
 * Cuál de sus accesos: con uno solo y sin decirlo, ese. Si lo dice, se busca
 * siempre (aunque tenga uno): «quítale el de Norte» a quien solo tiene el de
 * organización no puede quitarle el de organización en silencio.
 */
export function elegirAcceso(
  nombre: string,
  accesos: readonly Acceso[],
  dicho: string | undefined,
  para: string
): { item: Acceso } | { error: string } {
  const opciones = accesos
    .map((a, i) => `${i + 1}. ${etiquetaRol(a.rol, 'es')} ${ambito('es', a.ubicacion)}`)
    .join(', ');
  const preguntar = `Pregunta al usuario cuál quiere ${para} y pásalo en \`acceso\` (su número): ${opciones}.`;
  const texto = dicho?.trim();
  if (!texto)
    return accesos.length === 1
      ? { item: accesos[0] }
      : { error: `${nombre} tiene varios accesos en la organización. ${preguntar}` };
  if (/^\d+$/.test(texto)) {
    const a = accesos[Number(texto) - 1];
    return a ? { item: a } : { error: `No hay un acceso número ${texto}. ${preguntar}` };
  }
  const deUbicacion = accesos.filter((a) => a.ubicacion);
  const r = resolveByName(texto, deUbicacion, (a) => a.ubicacion!);
  if (r.kind === 'found') return { item: r.item };
  // Después de las ubicaciones: una que se llame «Global» gana. El número siempre funciona.
  const deOrganizacion = accesos.find((a) => !a.ubicacion);
  if (deOrganizacion && diceOrganizacion(texto)) return { item: deOrganizacion };
  return { error: `No encuentro el acceso «${texto}» de ${nombre}. ${preguntar}` };
}

/** Lo que resuelven las dos acciones en `preparar`: persona, su acceso y la lista para las protecciones. */
export async function resolverAcceso(
  gateway: PatrolTechGateway,
  ctx: ActionPrepareContext,
  p: { usuario: string; acceso?: string },
  para: string
): Promise<
  { persona: OrgUser; acceso: Acceso; accesos: Acceso[]; usuarios: OrgUser[] } | { error: string }
> {
  const [usuarios, ubicaciones] = await Promise.all([
    gateway.listOrgUsers(ctx.org.orgId, ctx.token),
    gateway.listLocations(ctx.org.orgId, ctx.token),
  ]);
  const persona = elegirPersona(usuarios, p.usuario);
  if ('error' in persona) return persona;
  const nombres = new Map(ubicaciones.map((l) => [l.id, l.name]));
  const accesos: Acceso[] = persona.item.roles.map((r) => ({
    id: r.id,
    rol: r.rol,
    ubicacion:
      r.ambito === 'LOCATION' ? (nombres.get(r.scopeId) ?? 'ubicación ya borrada') : undefined,
  }));
  if (accesos.length === 0)
    return { error: `${persona.item.nombre} no tiene ningún acceso en la organización.` };
  const acceso = elegirAcceso(persona.item.nombre, accesos, p.acceso, para);
  if ('error' in acceso) return acceso;
  return { persona: persona.item, acceso: acceso.item, accesos, usuarios };
}

/** ¿Quitar este rol (o bajarlo de ADMIN) deja la organización sin ningún Admin de organización? */
export function dejaSinAdmin(usuarios: readonly OrgUser[], orgId: string, rolId: string): boolean {
  const roles = usuarios.flatMap((u) => u.roles);
  const rol = roles.find((r) => r.id === rolId);
  if (!rol || !esAdminDeOrganizacion(rol, orgId)) return false;
  return !roles.some((r) => r.id !== rolId && esAdminDeOrganizacion(r, orgId));
}

/** Error al modelo de las dos protecciones en `preparar` (null = se puede). */
export function proteccionAlPreparar(
  ctx: ActionPrepareContext,
  usuarios: readonly OrgUser[],
  persona: OrgUser,
  acceso: Acceso,
  quitaAdmin: boolean
): string | null {
  if (persona.id === ctx.user.id) {
    return (
      `No lo propongas: ${persona.nombre} es el propio usuario. Explícale: «No puedo cambiar tu propio rol ni quitarte tu propio ` +
      `acceso; puede hacerlo otro Admin de ${ctx.org.name} desde el panel».`
    );
  }
  if (quitaAdmin && dejaSinAdmin(usuarios, ctx.org.orgId, acceso.id)) {
    return (
      `${persona.nombre} es el único Admin de toda la organización «${ctx.org.name}»: sin él la organización se queda sin nadie que ` +
      'pueda gestionarla. No lo propongas: primero hay que hacer Admin de la organización a otra persona ' +
      '(proponer_cambiar_rol_usuario o proponer_invitar_usuario).'
    );
  }
  return null;
}

/**
 * Las mismas protecciones al confirmar, con la lista del momento. Si alguna ya no
 * se cumple, lanza `AccionRechazada` con el texto al cliente (no se hace nada y
 * queda `failed`); si no, devuelve el `rol_id` ya comprobado. Un rol que ya no está en la lista también se para aquí: el
 * backend no da 404 sino 403 («Organization could not be resolved», porque saca
 * la organización del propio rol) y se traduciría como «no tienes permiso».
 */
export async function proteccionAlEjecutar(
  gateway: PatrolTechGateway,
  ctx: ActionContext,
  p: { usuario: string; usuario_id?: string; rol_id?: string },
  quitaAdmin: boolean
): Promise<string> {
  // Sin ellos no se puede comprobar «uno mismo»: solo pasa si no vino de `preparar`, y entonces no se hace.
  if (!p.usuario_id || !p.rol_id)
    throw new Error('acción de roles sin usuario_id o rol_id (no pasó por preparar)');
  const org = ctx.org.name;
  if (p.usuario_id === ctx.user.id) {
    throw sinCambios(ctx.language, {
      es: `desde aquí no puedes cambiar tu propio rol ni quitarte tu propio acceso. Puede hacerlo otro Admin de ${org}.`,
      en: `you can't change your own role or remove your own access from here. Another Admin of ${org} can do it.`,
      fr: `vous ne pouvez pas modifier votre propre rôle ni retirer votre propre accès d'ici. Un autre Admin de ${org} peut le faire.`,
    });
  }
  const usuarios = await gateway.listOrgUsers(ctx.org.orgId, ctx.token);
  if (!usuarios.some((u) => u.roles.some((r) => r.id === p.rol_id))) {
    throw sinCambios(ctx.language, {
      es: `${p.usuario} ya no tiene ese acceso en ${org} (quizá se cambió desde el panel). Pídemelo de nuevo si hace falta.`,
      en: `${p.usuario} no longer has that access in ${org} (it may have been changed in the dashboard). Ask me again if needed.`,
      fr: `${p.usuario} n'a plus cet accès dans ${org} (il a peut-être été modifié depuis le tableau de bord). Redemandez-le-moi si besoin.`,
    });
  }
  if (quitaAdmin && dejaSinAdmin(usuarios, ctx.org.orgId, p.rol_id)) {
    throw sinCambios(ctx.language, {
      es: `${p.usuario} es ahora el único Admin de toda la organización ${org}, y la organización no puede quedarse sin ninguno. Primero haz Admin de la organización a otra persona.`,
      en: `${p.usuario} is now the only Admin of the whole organization ${org}, and the organization can't be left without one. First make someone else an Admin of the organization.`,
      fr: `${p.usuario} est désormais le seul Admin de toute l'organisation ${org}, et l'organisation ne peut pas rester sans Admin. Nommez d'abord une autre personne Admin de l'organisation.`,
    });
  }
  return p.rol_id;
}

/** «al acceso de toda la organización» / «a la ubicación «X»», para el resumen del cambio de rol. */
export function accesoA(idioma: FixedTextLanguage, ubicacion: string | undefined): string {
  return segunIdioma(idioma, {
    es: ubicacion ? `acceso a la ubicación «${ubicacion}»` : 'acceso a toda la organización',
    en: ubicacion ? `access to the location «${ubicacion}»` : 'access to the whole organization',
    fr: ubicacion ? `accès au site «${ubicacion}»` : "accès à toute l'organisation",
  });
}
