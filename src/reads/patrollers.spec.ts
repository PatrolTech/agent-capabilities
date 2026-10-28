import { describe, it, expect } from 'vitest';
import { explainScan } from '../domain/scan-explanation.js';
import type { RecentScan } from '../gateway/index.js';
import {
  FakePatrolTechGateway,
  capabilityContext,
  readHarness,
  runRead,
} from '../testing/index.js';
import { readCapabilities } from './index.js';

describe('consultar_escaneos_por_vigilante', () => {
  it('cuenta total, válidos, sospechosos, no válidos y pendientes por vigilante, en ranking, con los que no escanearon', async () => {
    const { run, gateway } = readHarness();
    const rechazado: RecentScan = {
      timestamp: '2026-07-29T07:00:00Z',
      checkpointName: 'Almacén',
      patrollerName: 'Ana López',
      fraudFlagged: false,
      ...explainScan({
        validationStatus: 'rejected',
        validationReason: 'code_mismatch',
        fraudFlags: { flagged: false },
      }),
    };
    gateway.scans = [...gateway.scans, rechazado];
    gateway.patrollers = [
      ...gateway.patrollers,
      { id: 'p-luis', name: 'Luis Sanz', identifier: 'ABCDEF12', lastScanAt: null },
    ];

    const out = await run('consultar_escaneos_por_vigilante');

    expect(out.data).toMatchObject({
      totalEscaneos: 3,
      ranking: [
        {
          puesto: 1,
          vigilante: 'Ana López',
          total: 2,
          validos: 0,
          sospechosos: 1,
          noValidos: 1,
          pendientesRevision: 1,
        },
        {
          puesto: 2,
          vigilante: 'Juan Pérez',
          total: 1,
          validos: 1,
          sospechosos: 0,
          noValidos: 0,
          pendientesRevision: 0,
        },
        {
          puesto: 3,
          vigilante: 'Luis Sanz',
          total: 0,
          validos: 0,
          sospechosos: 0,
          noValidos: 0,
          pendientesRevision: 0,
        },
      ],
    });
    // Sin periodo: los últimos 7 días, paginando de 100 en 100.
    expect(gateway.scanOpts[0]).toMatchObject({ limit: 100, page: 1 });
    expect(gateway.scanOpts[0]?.dateFrom).toBeDefined();
  });

  it('por encima del tope avisa de que los recuentos son parciales', async () => {
    const { run, gateway } = readHarness();
    gateway.scans = Array.from({ length: 2050 }, () => gateway.scans[0]);

    const out = await run('consultar_escaneos_por_vigilante', { periodo: 'ultimos_30_dias' });

    expect(out).toMatchObject({ ok: true, truncado: true, data: { totalEscaneos: 2000 } });
    expect(out.avisos?.join(' ')).toMatch(/PARCIALES/);
  });
});

describe('enlaces_app_vigilantes', () => {
  it('enlace personal por vigilante, enlace general y aviso de reenviar cada uno solo a su vigilante', async () => {
    const { run } = readHarness();

    const out = await run('enlaces_app_vigilantes');

    expect(out.data).toEqual({
      enlaceGeneral: 'https://app.patroltech.online/org-a',
      enlaces: [
        { vigilante: 'Juan Pérez', enlace: 'https://app.patroltech.online/org-a/A1B2C3D4' },
        { vigilante: 'Ana López', enlace: 'https://app.patroltech.online/org-a/E5F6A7B8' },
      ],
    });
    expect(out.avisos?.[0]).toMatch(/SOLO a su vigilante/);
  });

  it('con `vigilante`: su enlace y el mensaje ya rellenado (sin huecos), con cómo instalar la app y en el idioma pedido', async () => {
    const { run } = readHarness();
    const mensaje = async (args: Record<string, unknown>) =>
      String((await run('enlaces_app_vigilantes', args)).data?.mensajeParaReenviar);

    const out = await run('enlaces_app_vigilantes', { vigilante: 'ana' });
    expect(out.data?.enlaces).toEqual([
      { vigilante: 'Ana López', enlace: 'https://app.patroltech.online/org-a/E5F6A7B8' },
    ]);
    const es = String(out.data?.mensajeParaReenviar);
    expect(es).toMatch(/^Hola Ana López,/);
    expect(es).toContain(
      'Tu enlace personal (no lo compartas): https://app.patroltech.online/org-a/E5F6A7B8'
    );
    expect(es).toContain('«Patrol Tech Scan» desde Google Play');
    expect(es).toContain('iPhone: no hay app en la App Store');
    expect(es).not.toMatch(/[{}]/);
    const en = await mensaje({ vigilante: 'Juan', idioma: 'en' });
    expect(en).toMatch(/^Hi Juan Pérez,/);
    expect(en).toContain(
      "Your personal link (don't share it): https://app.patroltech.online/org-a/A1B2C3D4"
    );
    const fr = await mensaje({ vigilante: 'Juan', idioma: 'fr' });
    expect(fr).toMatch(/^Bonjour Juan Pérez,/);
  });

  it('con un `vigilante` que no existe, las opciones (sin mensaje)', async () => {
    const { run } = readHarness();

    const out = await run('enlaces_app_vigilantes', { vigilante: 'Pedro' });

    expect(out.ok).toBe(false);
    expect(out.opciones).toEqual(['Juan Pérez', 'Ana López']);
  });

  it('la base de los enlaces es la `urls.app` del consumidor', async () => {
    const reads = readCapabilities({
      gateway: new FakePatrolTechGateway(),
      urls: { app: 'https://app.staging.test' },
    });

    const out = await runRead(reads, 'enlaces_app_vigilantes', capabilityContext());

    expect(out.data?.enlaceGeneral).toBe('https://app.staging.test/org-a');
  });
});

describe('consultar_ranking_vigilantes', () => {
  it('avisa, en el idioma del usuario, de que son datos de actividad y no una valoración de la persona', async () => {
    const { run, ctx } = readHarness();

    const es = await run('consultar_ranking_vigilantes');
    const en = await run('consultar_ranking_vigilantes', {}, { ...ctx, language: 'en' });

    expect(es.avisos?.join(' ')).toMatch(/actividad.*no (es )?una valoración/i);
    expect(es.avisos?.join(' ')).toMatch(/turnos|ausencias/i);
    expect(en.avisos?.join(' ')).toMatch(/activity.*not an assessment/i);
    expect(en.avisos?.join(' ')).toMatch(/shifts|absences/i);
  });

  it('el recorte va solo en el resultado, no repetido dentro de los datos', async () => {
    const { run, gateway } = readHarness();
    gateway.truncado = true;

    const out = await run('consultar_ranking_vigilantes');

    expect(out.ok).toBe(true);
    expect(out.truncado).toBe(true);
    expect(out.data).not.toHaveProperty('truncado');
    expect(out.data).toHaveProperty('ranking');
  });
});

describe('ranking y estadísticas de un vigilante: solo cifras, sin juicio', () => {
  const casos = [
    ['consultar_ranking_vigilantes', {}],
    ['consultar_stats_vigilante', { vigilante: 'Juan' }],
  ] as const;

  it.each(casos)(
    '%s pide no afirmar si alguien lo hizo bien o mal, ni si cumplió o falló',
    async (name, args) => {
      const { run, ctx } = readHarness();

      const es = await run(name, args);
      const en = await run(name, args, { ...ctx, language: 'en' });
      const fr = await run(name, args, { ...ctx, language: 'fr' });

      expect(es.ok).toBe(true);
      expect(es.avisos?.join(' ')).toMatch(/no afirmes si alguien lo ha hecho bien o mal/i);
      expect(es.avisos?.join(' ')).toMatch(/cumplido o fallado/i);
      expect(es.avisos?.join(' ')).toMatch(/solo cifras.*periodo/i);
      expect(en.avisos?.join(' ')).toMatch(/do not say whether anyone did well or badly/i);
      expect(en.avisos?.join(' ')).toMatch(/met or failed/i);
      expect(fr.avisos?.join(' ')).toMatch(/bien ou mal/i);
    }
  );
});

describe('descripciones: qué es la tasa de finalización', () => {
  it.each(['consultar_ranking_vigilantes', 'consultar_stats_vigilante'])(
    '%s la define como checkpoints escaneados sobre el total de checkpoints de sus rondas',
    (name) => {
      const read = readCapabilities({ gateway: new FakePatrolTechGateway() }).find(
        (r) => r.name === name
      )!;
      expect(read.description).toMatch(
        /porcentaje de checkpoints escaneados sobre el total de checkpoints de sus rondas/
      );
      expect(read.description).toMatch(/no es el porcentaje de rondas completadas/);
    }
  );
});
