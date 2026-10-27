/* eslint-disable @typescript-eslint/no-base-to-string, @typescript-eslint/require-await -- stubs de fetch portados del bot: la URL y el cuerpo que reciben son siempre strings y los stubs son async sin await */
import { describe, it, expect, vi } from 'vitest';
import { SdkPatrolTechGateway } from './SdkPatrolTechGateway.js';
import { PatrolTechApiError } from '../../domain/backend-errors.js';

const apiBase = 'http://api.test';

/** El backend responde `application/json`: el SDK solo parsea JSON con esa cabecera (el bot lo hacía a ciegas). */
const apiResponse = (body: BodyInit | null, init?: ResponseInit): Response =>
  new Response(body, { ...init, headers: { 'content-type': 'application/json' } });

function envelope(data: unknown, status = 200): Response {
  const body = status < 400 ? { success: true, message: 'OK', data, meta: {} } : data;
  return apiResponse(JSON.stringify(body), { status });
}

/** fetch falso que responde según la ruta; apunta las rutas pedidas. */
function routedFetch(route: (path: string) => Response) {
  const paths: string[] = [];
  const f = vi.fn<typeof fetch>(async (input: RequestInfo | URL) => {
    const path = String(input).slice(apiBase.length);
    paths.push(path);
    return route(path);
  });
  return { f, paths };
}

describe('SdkPatrolTechGateway — Control de Acceso e incidencias', () => {
  it('listCheckpoints y getCheckpoints: devuelven el identificador del checkpoint (columna «Identificador»)', async () => {
    const { f } = routedFetch((path) => {
      if (path.startsWith('/api/locations?')) return envelope([{ id: 'loc1', name: 'Sede' }]);
      return envelope({
        results: [
          {
            id: 'c1',
            name: 'Entrada',
            identifier: '7F3A9C21',
            locationId: 'loc1',
            archivedAt: null,
          },
          {
            id: 'c2',
            name: 'Entrada',
            identifier: '0B1C2D3E',
            locationId: 'loc1',
            archivedAt: null,
          },
          { id: 'c3', name: 'Viejo', locationId: 'loc1', archivedAt: null },
        ],
        count: 3,
        totalPages: 1,
      });
    });
    const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: f });

    const refs = await client.listCheckpoints('org1', 'jwt');
    const info = await client.getCheckpoints('org1', 'jwt');

    expect(refs.items[0].identificador).toBe('7F3A9C21');
    expect(refs.items[2]).not.toHaveProperty('identificador');
    // Dos checkpoints con el mismo nombre en la misma ubicación son dos, si tienen identificador distinto.
    expect(info.items).toEqual([
      { id: 'c1', name: 'Entrada', locationName: 'Sede', identificador: '7F3A9C21' },
      { id: 'c2', name: 'Entrada', locationName: 'Sede', identificador: '0B1C2D3E' },
      { id: 'c3', name: 'Viejo', locationName: 'Sede' },
    ]);
  });

  it('getIncidentDetail: GET del detalle con la ubicación en la query; timeline y adjuntos sin URLs', async () => {
    const { f, paths } = routedFetch(() =>
      envelope({
        id: 'i1',
        locationId: 'loc1',
        organizationId: 'org1',
        title: 'Puerta forzada',
        description: 'La puerta del almacén apareció abierta a las 3:00',
        status: 'IN_PROGRESS',
        priority: 'HIGH',
        categoryName: 'Seguridad',
        subcategoryName: 'Accesos',
        reporterName: 'Juan Pérez',
        assignedToName: 'Marta Ruiz',
        resolvedAt: null,
        closedAt: null,
        checkpoints: [{ id: 'c1', name: 'Almacén' }],
        createdAt: '2026-10-01T01:00:00.000Z',
        redacted: false,
        timeline: [
          {
            id: 't1',
            type: 'CREATED',
            content: null,
            authorName: 'Juan Pérez',
            oldValue: null,
            newValue: null,
            mediaUrl: null,
            mediaThumbnailUrl: null,
            createdAt: '2026-10-01T01:00:00.000Z',
          },
          {
            id: 't2',
            type: 'STATUS_CHANGE',
            content: null,
            authorName: 'Marta Ruiz',
            oldValue: 'OPEN',
            newValue: 'IN_PROGRESS',
            mediaUrl: null,
            mediaThumbnailUrl: null,
            createdAt: '2026-10-01T08:00:00.000Z',
          },
          {
            id: 't3',
            type: 'COMMENT',
            content: 'Revisado con el cliente',
            authorName: 'Marta Ruiz',
            oldValue: null,
            newValue: null,
            mediaUrl: 'https://s3.example/firmada?X-Amz-Signature=abc',
            mediaThumbnailUrl: 'https://s3.example/t?sig=1',
            createdAt: '2026-10-01T09:00:00.000Z',
          },
        ],
        media: [
          {
            id: 'm1',
            type: 'PHOTO',
            url: 'https://s3.example/a?X-Amz-Signature=abc',
            thumbnailUrl: null,
            filename: 'a.jpg',
            mimeType: 'image/jpeg',
            sizeBytes: 1,
            createdAt: '2026-10-01T01:00:00.000Z',
          },
          {
            id: 'm2',
            type: 'PHOTO',
            url: 'https://s3.example/b?X-Amz-Signature=abc',
            thumbnailUrl: null,
            filename: 'b.jpg',
            mimeType: 'image/jpeg',
            sizeBytes: 1,
            createdAt: '2026-10-01T01:00:00.000Z',
          },
          {
            id: 'm3',
            type: 'VIDEO',
            url: 'https://s3.example/c?X-Amz-Signature=abc',
            thumbnailUrl: null,
            filename: 'c.mp4',
            mimeType: 'video/mp4',
            sizeBytes: 1,
            createdAt: '2026-10-01T01:00:00.000Z',
          },
        ],
        availableTransitions: [],
      })
    );
    const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: f });

    const d = await client.getIncidentDetail(
      { incidentId: 'i1', organizationId: 'org1', locationId: 'loc1' },
      'jwt'
    );

    expect(paths).toEqual(['/api/features/incident-reporting/incidents/i1?locationId=loc1']);
    expect(d).toEqual({
      id: 'i1',
      oculta: false,
      titulo: 'Puerta forzada',
      descripcion: 'La puerta del almacén apareció abierta a las 3:00',
      estado: 'IN_PROGRESS',
      prioridad: 'HIGH',
      categoria: 'Seguridad',
      subcategoria: 'Accesos',
      reportadaPor: 'Juan Pérez',
      asignadaA: 'Marta Ruiz',
      locationId: 'loc1',
      creadaEn: '2026-10-01T01:00:00.000Z',
      resueltaEn: null,
      cerradaEn: null,
      checkpoints: ['Almacén'],
      timeline: [
        {
          tipo: 'CREATED',
          autor: 'Juan Pérez',
          texto: null,
          antes: null,
          despues: null,
          fecha: '2026-10-01T01:00:00.000Z',
          conAdjunto: false,
        },
        {
          tipo: 'STATUS_CHANGE',
          autor: 'Marta Ruiz',
          texto: null,
          antes: 'OPEN',
          despues: 'IN_PROGRESS',
          fecha: '2026-10-01T08:00:00.000Z',
          conAdjunto: false,
        },
        {
          tipo: 'COMMENT',
          autor: 'Marta Ruiz',
          texto: 'Revisado con el cliente',
          antes: null,
          despues: null,
          fecha: '2026-10-01T09:00:00.000Z',
          conAdjunto: true,
        },
      ],
      fotos: 2,
      videos: 1,
    });
    // Las URLs firmadas no salen del cliente.
    expect(JSON.stringify(d)).not.toContain('http');
  });

  it('getIncidentDetail: sin ubicación usa la organización (gate de la App) y un 404 es null', async () => {
    const { f, paths } = routedFetch(() =>
      envelope({ success: false, message: 'Incident not found', data: null }, 404)
    );
    const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: f });

    const d = await client.getIncidentDetail(
      { incidentId: 'i9', organizationId: 'org1', locationId: null },
      'jwt'
    );

    expect(d).toBeNull();
    expect(paths).toEqual(['/api/features/incident-reporting/incidents/i9?organizationId=org1']);
  });

  it('getIncidentDetail: una incidencia redactada por la retención sale como oculta, sin datos', async () => {
    const { f } = routedFetch(() =>
      envelope({
        id: 'i2',
        locationId: null,
        organizationId: 'org1',
        title: null,
        description: null,
        status: 'CLOSED',
        priority: 'LOW',
        createdAt: '2025-01-01T00:00:00.000Z',
        redacted: true,
        timeline: [],
        media: [],
      })
    );
    const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: f });

    const d = await client.getIncidentDetail(
      { incidentId: 'i2', organizationId: 'org1', locationId: null },
      'jwt'
    );

    expect(d).toMatchObject({
      oculta: true,
      titulo: null,
      descripcion: null,
      timeline: [],
      fotos: 0,
      videos: 0,
    });
  });

  it('listAccessLogs: GET con ubicación, filtros, página y límite ≤ 100; mapea persona, visitante y retención', async () => {
    const { f, paths } = routedFetch(() =>
      envelope({
        results: [
          {
            id: 'a1',
            locationId: 'loc1',
            zone: 'Portería',
            authorizedPersonId: 'ap1',
            authorizedPersonIdentifier: 'EMP-7',
            authorizedPersonName: 'Luis Gil',
            registeredByUserId: 'u1',
            type: 'ENTRY',
            timestamp: '2026-10-09T07:00:00.000Z',
            visitorName: null,
            visitorDocument: null,
            visitorCompany: null,
            destination: null,
            notes: null,
            createdAt: '2026-10-09T07:00:00.000Z',
            redacted: false,
          },
          {
            id: 'a2',
            locationId: 'loc1',
            zone: null,
            authorizedPersonId: null,
            authorizedPersonIdentifier: null,
            authorizedPersonName: null,
            registeredByUserId: 'u1',
            type: 'EXIT',
            timestamp: '2026-10-09T06:00:00.000Z',
            visitorName: 'Ana Sanz',
            visitorDocument: '12345678Z',
            visitorCompany: 'Limpiezas SA',
            destination: 'Oficina 2',
            notes: 'Trae paquete',
            createdAt: '2026-10-09T06:00:00.000Z',
            redacted: false,
          },
        ],
        total: 57,
        page: 2,
        limit: 100,
      })
    );
    const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: f });

    const r = await client.listAccessLogs(
      {
        locationId: 'loc1',
        zona: 'Portería',
        tipo: 'ENTRY',
        desde: '2026-10-08T22:00:00.000Z',
        hasta: '2026-10-09T22:00:00.000Z',
        page: 2,
        limit: 500,
      },
      'jwt'
    );

    expect(paths).toEqual([
      '/api/features/access-control/access-logs?locationId=loc1&page=2&limit=100&zone=Porter%C3%ADa&type=ENTRY&from=2026-10-08T22%3A00%3A00.000Z&to=2026-10-09T22%3A00%3A00.000Z',
    ]);
    expect(r.total).toBe(57);
    expect(r.items).toEqual([
      {
        id: 'a1',
        locationId: 'loc1',
        zona: 'Portería',
        tipo: 'ENTRY',
        fecha: '2026-10-09T07:00:00.000Z',
        persona: 'Luis Gil',
        identificadorPersona: 'EMP-7',
        visitante: null,
        documentoVisitante: null,
        empresaVisitante: null,
        destino: null,
        notas: null,
        oculto: false,
      },
      {
        id: 'a2',
        locationId: 'loc1',
        zona: null,
        tipo: 'EXIT',
        fecha: '2026-10-09T06:00:00.000Z',
        persona: null,
        identificadorPersona: null,
        visitante: 'Ana Sanz',
        documentoVisitante: '12345678Z',
        empresaVisitante: 'Limpiezas SA',
        destino: 'Oficina 2',
        notas: 'Trae paquete',
        oculto: false,
      },
    ]);
  });

  it('listActiveAccessEntries: GET …/access-logs/active con ubicación (y zona)', async () => {
    const { f, paths } = routedFetch(() =>
      envelope([
        {
          id: 'a1',
          locationId: 'loc1',
          zone: null,
          authorizedPersonId: null,
          authorizedPersonIdentifier: null,
          authorizedPersonName: null,
          registeredByUserId: 'u1',
          type: 'ENTRY',
          timestamp: '2026-10-09T07:00:00.000Z',
          visitorName: null,
          visitorDocument: null,
          visitorCompany: null,
          destination: null,
          notes: null,
          createdAt: '2026-10-09T07:00:00.000Z',
          redacted: true,
        },
      ])
    );
    const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: f });

    const r = await client.listActiveAccessEntries('loc1', 'jwt', 'Garaje');

    expect(paths).toEqual([
      '/api/features/access-control/access-logs/active?locationId=loc1&zone=Garaje',
    ]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ tipo: 'ENTRY', oculto: true });
  });

  it('Control de Acceso apagado: el 403 del gate se propaga como PatrolTechApiError', async () => {
    const { f } = routedFetch(() =>
      envelope(
        {
          success: false,
          message: "Feature 'access-control' is not enabled for this organization",
          data: null,
        },
        403
      )
    );
    const client = new SdkPatrolTechGateway({ baseUrl: apiBase, fetchImpl: f });

    const err = await client.listAccessLogs({ locationId: 'loc1' }, 'jwt').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(PatrolTechApiError);
  });
});
