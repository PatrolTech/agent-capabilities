import {
  createOrganizationUser,
  deleteUserRole as sdkDeleteUserRole,
  getCreateOrganizationUserUrl,
  getDeleteUserRoleUrl,
  getGetOrganizationUsersUrl,
  getOrganizationUsers,
  getUpdateUserPreferencesUrl,
  getUpdateUserRoleUrl,
  updateUserPreferences,
  updateUserRole as sdkUpdateUserRole,
} from '@patroltech/sdk-api';
import type { AlertChannel, AlertType, InviteResult, NewOrgUser, OrgUser } from '../types/index.js';
import type { SdkTransport } from './transport.js';

export async function setAlertPreference(
  t: SdkTransport,
  input: { tipo: AlertType; canal: AlertChannel; activar: boolean },
  token: string
): Promise<void> {
  // El backend fusiona `channels` tipo a tipo y canal a canal con lo guardado:
  // mandar solo el que cambia no toca el resto.
  const body = {
    notificationPreferences: { channels: { [input.tipo]: { [input.canal]: input.activar } } },
  };
  await t.envelope(token, getUpdateUserPreferencesUrl(), (init) =>
    updateUserPreferences(body, init)
  );
}

export async function listOrgUsers(
  t: SdkTransport,
  accountId: string,
  token: string
): Promise<OrgUser[]> {
  const params = { organizationId: accountId };
  const body = await t.data(token, getGetOrganizationUsersUrl(params), (init) =>
    getOrganizationUsers(params, init)
  );
  return body.results.map((u) => ({
    id: u.id,
    nombre: u.name,
    email: u.email,
    roles: (u.UserRoles ?? []).map((r) => ({
      id: r.id,
      rol: r.roleType,
      ambito: r.roleScope,
      scopeId: r.scopeId,
    })),
  }));
}

export async function inviteUser(
  t: SdkTransport,
  input: NewOrgUser,
  token: string
): Promise<InviteResult> {
  // Campos uno a uno (nunca un spread): el backend usaría un `id` para crear el usuario.
  const body = {
    organizationId: input.organizationId,
    name: input.name,
    email: input.email,
    roleType: input.roleType,
    roleScope: input.roleScope,
    ...(input.roleScope === 'LOCATION' && input.locationId ? { locationId: input.locationId } : {}),
  };
  // `data` es null: lo que importa va en el envelope. `meta.emailSent` solo viene con una cuenta nueva.
  const res = await t.envelope(token, getCreateOrganizationUserUrl(), (init) =>
    createOrganizationUser(body, init)
  );
  const emailSent = (res.meta as { emailSent?: unknown } | undefined)?.emailSent;
  return { cuentaNueva: typeof emailSent === 'boolean', emailEnviado: emailSent !== false };
}

export async function updateUserRole(
  t: SdkTransport,
  input: { userRoleId: string; roleType: 'VIEWER' | 'EDITOR' | 'ADMIN' },
  token: string
): Promise<void> {
  // Solo `roleType`: el backend saca la organización del propio rol, no del body.
  const id = input.userRoleId;
  await t.envelope(token, getUpdateUserRoleUrl(id), (init) =>
    sdkUpdateUserRole(id, { roleType: input.roleType }, init)
  );
}

export async function deleteUserRole(
  t: SdkTransport,
  userRoleId: string,
  token: string
): Promise<void> {
  const id = userRoleId;
  await t.envelope(token, getDeleteUserRoleUrl(id), (init) => sdkDeleteUserRole(id, init));
}
