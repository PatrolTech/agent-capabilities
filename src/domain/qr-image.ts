import { toBuffer } from 'qrcode';

/**
 * Lado del PNG en píxeles: a 300 ppp son ~8,5 cm, de sobra para imprimir y
 * pegar el QR junto al punto de control sin que se pixele.
 */
export const QR_IMAGE_SIZE_PX = 1024;

export interface QrImage {
  png: Buffer;
  /** Pie para el mensaje: nombre del checkpoint y el código tal cual va en el QR. */
  caption: string;
}

/**
 * Imagen del QR de un checkpoint (el texto `PT-XXXXXXXXXX` o una URL) lista para
 * imprimir, con el pie que la acompaña en el mensaje.
 *
 * `qrcode` sin canvas solo pinta el QR; escribir el nombre y el
 * código al pie DENTRO del PNG exigiría una dependencia nativa (canvas) o una
 * fuente de mapa de bits propia. El nombre y el código van en el `caption` del
 * mensaje; si hace falta en la propia imagen, se compone aquí sin cambiar a
 * los llamadores.
 */
export async function checkpointQrImage(input: { code: string; name: string }): Promise<QrImage> {
  const png = await toBuffer(input.code, {
    type: 'png',
    width: QR_IMAGE_SIZE_PX,
    // Margen de 4 módulos: el mínimo que pide el estándar para que lea bien impreso.
    margin: 4,
    // M (~15 % recuperable): aguanta una pegatina algo rayada sin engordar el QR.
    errorCorrectionLevel: 'M',
  });
  return { png, caption: `${input.name}\n${input.code}` };
}
