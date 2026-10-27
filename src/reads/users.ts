import { PatrolTechApiError } from '../domain/backend-errors.js';
import { fail, ok } from '../domain/tool-result.js';
import type { OrgUser } from '../gateway/index.js';
import { ROL_LABEL } from './support/roles.js';
import { defineRead, type ReadCapability, type ReadEnv } from './types.js';

const usuariosRolesDesc =
  'Lista los usuarios del panel de la organización (gestores y observadores) con su rol (Admin, Editor u Observador) y su ámbito (toda la organización o una ubicación), y explica qué puede cambiar cada rol. Úsala para «¿quién puede cambiar rutas, checkpoints o vigilantes?», «¿qué usuarios tenemos?». Solo la puede consultar un Admin de la organización: si falla por permisos, explícalo.';

const AMBITO_DE_LOS_ROLES =
  'Un rol de organización vale para todas las ubicaciones; uno de ubicación, solo para esa (con los dos, vale el más alto). Con rol solo de ubicación no se pueden ver ni exportar los escaneos, ver o crear patrulleros, crear rutas, gestionar chips NFC ni generar el certificado.';

/**
 * Qué puede hacer cada rol (Admin, Editor, Viewer) y con qué ámbito.
 * Sin upsell (MCP) se omite lo de Licencia, facturas y pagos.
 */
function queHaceCadaRol(upsell: boolean) {
  return {
    observador: upsell
      ? 'Solo consulta: no crea ni edita nada, no imprime QR y no ve Licencia.'
      : 'Solo consulta: no crea ni edita nada y no imprime QR.',
    editor: `Además de consultar, crea y edita checkpoints, rutas, patrulleros (vigilantes), personas autorizadas e incidencias (en el panel)${upsell ? '; ve Licencia y facturas, pero no cambia el plan.' : '.'}`,
    admin: `Además de lo del Editor, en el panel: usuarios y roles, ubicaciones, datos de empresa, privacidad del vigilante, Apps, zonas de acceso, categorías y plantillas de incidencias${upsell ? ', y pagos.' : '.'}`,
    ambito: AMBITO_DE_LOS_ROLES,
  };
}

/** Usuarios del panel con su rol y ámbito. */
export function userReads({ gateway, upsell }: ReadEnv): ReadCapability[] {
  return [
    defineRead({
      name: 'consultar_usuarios_y_roles',
      description: usuariosRolesDesc,
      params: {},
      call: async ({ org, token }) => {
        let usuarios: OrgUser[];
        try {
          usuarios = await gateway.listOrgUsers(org.orgId, token);
        } catch (err) {
          if (err instanceof PatrolTechApiError && err.status === 403) {
            return fail(
              'Solo un Admin de la organización puede ver sus usuarios y roles (en el panel, Usuarios). Con el rol de este usuario no se pueden consultar: que se lo pregunte a un Admin de su cuenta.'
            );
          }
          throw err;
        }
        const ubicaciones = new Map(
          (await gateway.listLocations(org.orgId, token)).map((l) => [l.id, l.name])
        );
        return ok({
          usuarios: usuarios.map((u) => ({
            nombre: u.nombre,
            email: u.email,
            roles: u.roles.map((r) => {
              const rol = ROL_LABEL[r.rol] ?? r.rol;
              return r.ambito === 'LOCATION'
                ? `${rol} de la ubicación «${ubicaciones.get(r.scopeId) ?? r.scopeId}»`
                : `${rol} de toda la organización`;
            }),
          })),
          queHaceCadaRol: queHaceCadaRol(upsell),
        });
      },
    }),
  ];
}
