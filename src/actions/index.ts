import { capabilityEnv } from '../deps.js';
import { setAlertPreference } from './alerts.js';
import { editCheckpointAntifraud, moveCheckpoint } from './checkpoint-geo.js';
import { archiveCheckpoint } from './checkpoint-archive.js';
import { createCheckpoint, editCheckpoint } from './checkpoints.js';
import { incidentUpdate } from './incidents.js';
import { deleteLocation, editLocation } from './locations.js';
import { withOrganizationGuard } from './guard.js';
import { createPatroller, editPatroller } from './patrollers.js';
import { addTimeWindow, deleteTimeWindow } from './route-schedules.js';
import { createRoute, routeCheckpoint, setRouteActive } from './routes.js';
import type { ActionDefinition, ActionDeps, ActionEnv } from './types.js';
import { changeUserRole, removeUserAccess } from './user-roles.js';
import { inviteUser } from './users.js';

export * from './types.js';
export * from './names.js';
export * from './batch-policy.js';
export { withOrganizationGuard } from './guard.js';
export { CHECKPOINT_RECOVERY_WINDOW_MS } from './checkpoints.js';
export { newPatrollerIdentifier } from './patrollers.js';
export { nuevoTurno, turnoDe, type TurnoConRegistro } from './support/turno.js';
export { internalParamNames } from './support/shared.js';
export {
  isOnboardingAction,
  nextOnboardingStep,
  ONBOARDING_ACTIONS,
  type NextStep,
  type OnboardingAction,
} from './support/next-step.js';
export {
  actionTexts,
  NEXT_STEP_TEXTS,
  type ActionTexts,
  type NextStepButton,
} from './support/texts.js';

/**
 * El catálogo de las 19 acciones de escritura, en el orden de `BOT_ACTIONS`. El
 * motor de cada consumidor (tools `proponer_*`, confirmación, ejecución única)
 * es el mismo para todas; cuáles se ofrecen lo deciden sus flags
 * (`isActionEnabled`) y el rol del usuario (`roleAllows`). Todas van con
 * `withOrganizationGuard`: ni preparan ni ejecutan fuera de las organizaciones de la sesión.
 */
export function actionCatalog(deps: ActionDeps): ActionDefinition[] {
  const env: ActionEnv = capabilityEnv(deps);
  return [
    createCheckpoint(env),
    createPatroller(env),
    setAlertPreference(env),
    // Rutas y horarios.
    createRoute(env),
    addTimeWindow(env),
    deleteTimeWindow(env),
    setRouteActive(env),
    routeCheckpoint(env),
    // Incidencias, editar vigilante y checkpoint, archivar checkpoint.
    incidentUpdate(env),
    editPatroller(env),
    editCheckpoint(env),
    archiveCheckpoint(env),
    // Antifraude y posición.
    editCheckpointAntifraud(env),
    moveCheckpoint(env),
    // Editar y borrar ubicación, invitar al panel.
    editLocation(env),
    deleteLocation(env),
    inviteUser(env),
    // Cambiar el rol y quitar el acceso a quien ya está en el panel.
    changeUserRole(env),
    removeUserAccess(env),
  ].map(withOrganizationGuard);
}
