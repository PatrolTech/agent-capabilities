import { readCapabilities } from '../reads/index.js';
import type { OrganizationRef } from '../context.js';
import type { CapabilityContext, ReadCapability } from '../reads/types.js';
import { FakePatrolTechGateway } from './FakePatrolTechGateway.js';
import { RecordingFileSink } from './RecordingFileSink.js';

/** Contexto de prueba: una sola organización (`org-a`), zona de Madrid, país ES y español. */
export function capabilityContext(overrides: Partial<CapabilityContext> = {}): CapabilityContext {
  const org: OrganizationRef = overrides.org ??
    overrides.organizations?.[0] ?? { orgId: 'org-a', name: 'Acme Seguridad' };
  return {
    org,
    organizations: overrides.organizations ?? [org],
    token: 'jwt',
    tz: 'Europe/Madrid',
    country: 'ES',
    language: 'es',
    ...overrides,
  };
}

/** Forma laxa de un `ToolResult` para las aserciones de los tests. */
export interface LooseToolResult {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: string;
  opciones?: string[];
  avisos?: string[];
  truncado?: boolean;
}

/** Busca la capacidad por su nombre y la llama como lo haría el consumidor (sin validar `args`). */
export async function runRead(
  reads: readonly ReadCapability[],
  name: string,
  ctx: CapabilityContext,
  args: Record<string, unknown> = {}
): Promise<LooseToolResult> {
  const read = reads.find((r) => r.name === name);
  if (!read) throw new Error(`No existe la capacidad ${name}`);
  return (await read.call(ctx, args)) as unknown as LooseToolResult;
}

/**
 * Fake del backend + capacidades + contexto de una organización, listos para
 * llamar por nombre. Por defecto el canal entrega ficheros (`offerFiles` y un
 * `RecordingFileSink` en `ctx.files`); con `withFiles: false`, ni lo uno ni lo otro.
 */
export function readHarness(opts: { withFiles?: boolean; ctx?: Partial<CapabilityContext> } = {}) {
  const gateway = new FakePatrolTechGateway();
  const withFiles = opts.withFiles !== false;
  const files = withFiles ? new RecordingFileSink() : undefined;
  const reads = readCapabilities({ gateway, offerFiles: withFiles });
  const ctx = capabilityContext({ files, ...opts.ctx });
  const run = (name: string, args: Record<string, unknown> = {}, at: CapabilityContext = ctx) =>
    runRead(reads, name, at, args);
  return { gateway, files, reads, ctx, run };
}
