import { describe, it, expect } from 'vitest';
import { csvCell, scansCsv, type ScanCsvRow } from './scans-csv.js';

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

describe('csvCell', () => {
  it('entrecomilla y dobla las comillas si la celda lleva ;, comillas o saltos de línea', () => {
    expect(csvCell('a;b')).toBe('"a;b"');
    expect(csvCell('dijo "hola"')).toBe('"dijo ""hola"""');
    expect(csvCell('línea 1\nlínea 2')).toBe('"línea 1\nlínea 2"');
    expect(csvCell('normal')).toBe('normal');
  });

  it('neutraliza fórmulas: texto que empieza por =, +, -, @ lleva un apóstrofo delante', () => {
    expect(csvCell('=HYPERLINK("http://x","clic")')).toBe(`"'=HYPERLINK(""http://x"",""clic"")"`);
    expect(csvCell('+34 600')).toBe("'+34 600");
    expect(csvCell('-2+3')).toBe("'-2+3");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
  });

  // Corrección respecto al bot: con la coma como separador de lista, Excel parte la fila por comas
  // y el fragmento tras la coma se ejecutaría como fórmula.
  it('entrecomilla las celdas con coma o tabulador: «Nave,=1+1» sale como una sola celda', () => {
    expect(csvCell('Nave,=1+1')).toBe('"Nave,=1+1"');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('a	b')).toBe('"a	b"');
  });

  it('sigue neutralizando el inicio de fórmula (=, +, -, @) aunque lleve coma', () => {
    expect(csvCell('=1+1')).toBe("'=1+1");
    expect(csvCell('+34 600')).toBe("'+34 600");
    expect(csvCell('-2+3')).toBe("'-2+3");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('=A1,B1')).toBe(`"'=A1,B1"`);
  });

  it('un valor sin caracteres especiales no se entrecomilla (paridad con el bot)', () => {
    expect(csvCell('Juan Pérez')).toBe('Juan Pérez');
    expect(csvCell('Entrada principal')).toBe('Entrada principal');
  });

  it('los números y los vacíos no se tocan', () => {
    expect(csvCell(-5)).toBe('-5');
    expect(csvCell(42)).toBe('42');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell(null)).toBe('');
  });
});

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
});
