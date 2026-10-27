import { readFileSync } from 'node:fs';
import * as sdk from '@patroltech/sdk-api';
import { describe, expect, it } from 'vitest';
import { FakePatrolTechGateway } from '../testing/index.js';
import { buildCatalog } from './buildCatalog.js';
import { ACTION_ENTRIES, READ_ENTRIES } from './entries.js';

/**
 * El catálogo frente al contrato público de la API de PatrolTech.
 *
 * `@patroltech/sdk-api` no incluye el contrato en el paquete npm, así que se lee
 * el que publica su repositorio en la etiqueta de la versión instalada
 * (`v<versión>`): el mismo documento del que se generó el SDK que usa este
 * paquete. Al subir el SDK (Dependabot), el test pasa a validar contra el
 * contrato nuevo sin tocar nada.
 *
 * Sin red, `PATROLTECH_PUBLIC_CONTRACT=<ruta a openapi.public.json>` usa una
 * copia local (la de la misma etiqueta).
 */
const sdkVersion = (
  JSON.parse(
    readFileSync(
      new URL('../../node_modules/@patroltech/sdk-api/package.json', import.meta.url),
      'utf8'
    )
  ) as { version: string }
).version;
const contractUrl = `https://raw.githubusercontent.com/PatrolTech/sdk-api/v${sdkVersion}/openapi/openapi.public.json`;

interface OpenApiContract {
  info: { version: string };
  paths: Record<string, Record<string, { operationId?: string }>>;
}

async function loadContract(): Promise<OpenApiContract> {
  const localFile = process.env.PATROLTECH_PUBLIC_CONTRACT;
  if (localFile) return JSON.parse(readFileSync(localFile, 'utf8')) as OpenApiContract;
  const response = await fetch(contractUrl, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) {
    throw new Error(`No se pudo leer el contrato público (${response.status}): ${contractUrl}`);
  }
  return (await response.json()) as OpenApiContract;
}

const contract = await loadContract();

/** Método HTTP de cada operationId del contrato. */
const contractMethods = new Map(
  Object.values(contract.paths).flatMap((item) =>
    Object.entries(item).flatMap(([method, operation]) =>
      operation.operationId ? [[operation.operationId, method.toUpperCase()] as const] : []
    )
  )
);

// Las escrituras (no GET) que llaman las capacidades del canal mcp. La API de
// PatrolTech solo permite a un agente MCP una lista cerrada de escrituras y
// responde 403 `AGENT_WRITE_NOT_ALLOWED` a cualquier otra: una escritura nueva en
// el canal mcp tiene que estar permitida antes en la API.
const MCP_WRITE_OPERATIONS = [
  'addCheckpointToRoute',
  'addIncidentComment',
  'addTimeWindowToRoute',
  'assignIncident',
  'createCheckpoint',
  'createRouteComplete',
  'removeCheckpointFromRoute',
  'toggleRouteActive',
  'updateCheckpoint',
  'updateIncidentStatus',
  'updateLocation',
  'updatePatroller',
  'updateUserPreferences',
];

const entries = [...READ_ENTRIES, ...ACTION_ENTRIES];

describe(`contrato público (@patroltech/sdk-api ${sdkVersion})`, () => {
  it('cada operationId de cualquier capacidad (bot o mcp) está en el contrato público', () => {
    expect(entries.some((m) => !m.channels.includes('mcp'))).toBe(true);
    for (const meta of entries) {
      expect(meta.operationIds.length, meta.id).toBeGreaterThan(0);
      for (const id of meta.operationIds) {
        expect(contractMethods.has(id), `${meta.id} -> ${id} no está en el contrato`).toBe(true);
      }
    }
  });

  it('cada operationId es una función de @patroltech/sdk-api', () => {
    for (const meta of entries) {
      for (const id of meta.operationIds) {
        expect(typeof (sdk as Record<string, unknown>)[id], `${meta.id} -> ${id}`).toBe('function');
      }
    }
  });

  it('las escrituras del catálogo mcp son exactamente las que la API permite a los agentes', () => {
    const { reads, actions } = buildCatalog(
      { gateway: new FakePatrolTechGateway(), offerFiles: true },
      { channel: 'mcp' }
    );
    const used = new Set<string>();
    for (const { meta } of [...reads, ...actions]) {
      for (const id of meta.operationIds) {
        if (contractMethods.get(id) !== 'GET') used.add(id);
      }
    }

    expect([...used].sort()).toEqual(MCP_WRITE_OPERATIONS);
  });
});
