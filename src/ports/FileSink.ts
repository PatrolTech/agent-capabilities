/**
 * Dónde dejar los ficheros que generan las capacidades (el QR de un checkpoint,
 * un Excel de escaneos…). Cada consumidor lo implementa a su manera: el bot los
 * envía por el chat, el servidor MCP los devuelve como contenido de la herramienta.
 */
export interface FileSink {
  /** Una imagen PNG, con un pie opcional. */
  sendImage(file: { png: Uint8Array; caption?: string }): Promise<void>;
  /** Un documento cualquiera (p. ej. un CSV para Excel), con un pie opcional. */
  sendDocument(file: {
    bytes: Uint8Array;
    filename: string;
    mimeType: string;
    caption?: string;
  }): Promise<void>;
}
