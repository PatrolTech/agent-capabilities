/** Usuario del panel con sus roles en la organización (`ambito` LOCATION → `scopeId` es la ubicación). */
export interface OrgUser {
  id: string;
  nombre: string;
  email: string;
  /** `id` = el `userRoleId` que piden cambiar el rol y quitar el acceso. */
  roles: { id: string; rol: string; ambito: string; scopeId: string }[];
}

/**
 * Invitación al panel. Sin `id` a propósito: el backend lo usaría para crear el
 * usuario. `locationId` solo con `roleScope` LOCATION, y siempre de las
 * ubicaciones de la organización (el backend no lo comprueba).
 */
export interface NewOrgUser {
  organizationId: string;
  name: string;
  email: string;
  roleType: 'VIEWER' | 'EDITOR' | 'ADMIN';
  roleScope: 'ORGANIZATION' | 'LOCATION';
  locationId?: string;
}

/** `cuentaNueva` false = el email ya tenía cuenta y solo se le añade el rol; `emailEnviado` false = falló el correo de bienvenida. */
export interface InviteResult {
  cuentaNueva: boolean;
  emailEnviado: boolean;
}
