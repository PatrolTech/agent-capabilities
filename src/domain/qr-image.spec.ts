import { describe, it, expect } from 'vitest';
import { QR_IMAGE_SIZE_PX, checkpointQrImage } from './qr-image.js';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Ancho y alto del PNG, leídos de la cabecera IHDR (justo tras la firma). */
function pngSize(png: Buffer): { width: number; height: number } {
  expect(png.subarray(12, 16).toString('ascii')).toBe('IHDR');
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

describe('checkpointQrImage', () => {
  // No se decodifica el QR (haría falta un lector de QR y de PNG como
  // dependencias solo para esto); se comprueba que es un PNG cuadrado del tamaño
  // imprimible y que el contenido depende del código.
  it('genera un PNG cuadrado del tamaño imprimible', async () => {
    const { png } = await checkpointQrImage({ code: 'PT-ABCDEF1234', name: 'Entrada principal' });
    expect(png.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
    expect(pngSize(png)).toEqual({ width: QR_IMAGE_SIZE_PX, height: QR_IMAGE_SIZE_PX });
  });

  it('códigos distintos dan imágenes distintas', async () => {
    const a = await checkpointQrImage({ code: 'PT-ABCDEF1234', name: 'X' });
    const b = await checkpointQrImage({ code: 'PT-ABCDEF1235', name: 'X' });
    expect(a.png.equals(b.png)).toBe(false);
  });

  it('el pie lleva el nombre del checkpoint y el código', async () => {
    const { caption } = await checkpointQrImage({
      code: 'https://patroltech.online/c/PT-1',
      name: 'Almacén',
    });
    expect(caption).toBe('Almacén\nhttps://patroltech.online/c/PT-1');
  });
});
