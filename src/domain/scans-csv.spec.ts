import { describe, it, expect } from 'vitest';
import { scansCsv, type ScanCsvRow } from './scans-csv.js';

const scan = (over: Partial<ScanCsvRow> = {}): ScanCsvRow => ({
  timestamp: '2026-07-29T08:00:00Z',
  checkpointName: 'Entrada',
  patrollerName: 'Juan Pérez',
  fraudFlagged: false,
  validacion: 'válido',
  motivosSospecha: [],
  ...over,
});

const texto = (buf: Buffer): string => buf.toString('utf8');

describe('scansCsv', () => {
  it('UTF-8 con BOM, separador ; y cabeceras en español', () => {
    const csv = texto(scansCsv([scan()], { tz: 'Europe/Madrid', ubicacionDe: () => 'Sede' }));
    expect(csv.startsWith('﻿')).toBe(true);
    const [cabecera] = csv.slice(1).split('\r\n');
    expect(cabecera).toBe(
      'Fecha y hora;Vigilante;Checkpoint;Ubicación;Validación;Sospechoso;Distancia GPS (m);Dispositivo;Batería %'
    );
  });

  it('la fecha va en la zona horaria del cliente', () => {
    const madrid = texto(scansCsv([scan()], { tz: 'Europe/Madrid', ubicacionDe: () => '' }));
    const mexico = texto(scansCsv([scan()], { tz: 'America/Mexico_City', ubicacionDe: () => '' }));
    expect(madrid.split('\r\n')[1].startsWith('2026-07-29 10:00:00;')).toBe(true);
    expect(mexico.split('\r\n')[1].startsWith('2026-07-29 02:00:00;')).toBe(true);
  });

  it('una fila con sospecha, dispositivo, batería y distancia; un nombre con fórmula queda neutralizado', () => {
    const csv = texto(
      scansCsv(
        [
          scan({
            patrollerName: '=cmd|calc',
            fraudFlagged: true,
            motivosSospecha: ['GPS lejos', 'otra'],
            distanciaGpsM: 120,
            dispositivo: { modelo: 'Galaxy A5', sistema: 'Android 14', bateriaPct: 37 },
          }),
        ],
        { tz: 'UTC', ubicacionDe: () => 'Sede Central' }
      )
    );
    expect(csv.split('\r\n')[1]).toBe(
      `2026-07-29 08:00:00;'=cmd|calc;Entrada;Sede Central;válido;"sí: GPS lejos; otra";120;Galaxy A5 · Android 14;37`
    );
  });

  it('solo se sanean las columnas de texto: distancia y batería, numéricas, salen tal cual', () => {
    const csv = texto(
      scansCsv(
        [
          scan({
            patrollerName: ' =1+1',
            checkpointName: '\t=1+1',
            distanciaGpsM: -3,
            dispositivo: { modelo: '+34 600', bateriaPct: 5 },
          }),
        ],
        { tz: 'UTC', ubicacionDe: () => '@Sede' }
      )
    );
    expect(csv.split('\r\n')[1]).toBe(
      `2026-07-29 08:00:00;' =1+1;"'\t=1+1";'@Sede;válido;no;-3;'+34 600;5`
    );
  });
});
