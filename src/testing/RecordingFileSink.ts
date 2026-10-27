/* eslint-disable @typescript-eslint/require-await -- sumidero en memoria de un puerto asíncrono: no espera nada. */
import type { FileSink } from '../ports/FileSink.js';

type SentImage = Parameters<FileSink['sendImage']>[0];
type SentDocument = Parameters<FileSink['sendDocument']>[0];

/** `FileSink` de prueba: guarda en orden las imágenes y documentos que recibe. */
export class RecordingFileSink implements FileSink {
  readonly images: SentImage[] = [];
  readonly documents: SentDocument[] = [];

  async sendImage(file: SentImage): Promise<void> {
    this.images.push(file);
  }

  async sendDocument(file: SentDocument): Promise<void> {
    this.documents.push(file);
  }
}
