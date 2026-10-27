/**
 * Almacén de las acciones de escritura que se proponen al usuario y esperan su
 * confirmación. Solo los tipos: las implementaciones (base de datos en el bot, en
 * memoria en el servidor MCP…) viven en cada consumidor.
 *
 * Refleja las operaciones del almacén de propuestas del bot
 * con `contextKey` en lugar de `threadId`: la clave de la conversación o sesión a
 * la que pertenecen las propuestas (solo hay un lote vivo por clave).
 *
 * `contextKey` tiene que atar al USUARIO y a su cliente o conversación (p. ej.
 * `<userId>:<conversationId>` en el bot, `<userId>:<clientId>:<sessionId>` en el
 * MCP) y no compartirse NUNCA entre usuarios: quien tenga la clave puede
 * confirmar, cancelar o ver las propuestas de ese lote.
 */

export type PendingActionStatus =
  'proposed' | 'executing' | 'executed' | 'failed' | 'cancelled' | 'expired';

export interface PendingAction {
  id: string;
  /** Usuario + cliente/conversación: nunca compartida entre usuarios (ver arriba). */
  contextKey: string;
  /** Nombre de la acción del catálogo (`ActionDefinition.nombre`, p. ej. `create_checkpoint`). */
  action: string;
  params: unknown;
  organizationId: string | null;
  status: PendingActionStatus;
  idempotencyKey: string | null;
  result: unknown;
  error: string | null;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
  /** Lote de propuestas del mismo turno, que se confirman de una vez (null en las anteriores a los lotes). */
  batchId: string | null;
}

/** Una acción del lote, tal como se guarda al proponerla. */
export interface ProposedItem {
  action: string;
  params: unknown;
  organizationId: string | null;
  idempotencyKey?: string | null;
}

export interface PendingActionStore {
  /**
   * Guarda un lote de acciones propuestas (las del mismo turno) con el mismo
   * `batchId` y en el orden de la lista que verá el usuario. Las `proposed`
   * anteriores de la misma clave se retiran (`cancelled`, o `expired` si ya
   * habían caducado). La caducidad la calcula el almacén, con el mismo reloj que
   * usa `claimForExecution`.
   */
  proposeActions(input: {
    contextKey: string;
    ttlMin: number;
    items: ProposedItem[];
  }): Promise<PendingAction[]>;

  /** Las acciones de un lote, en el orden de la lista que vio el usuario. */
  findBatch(contextKey: string, batchId: string): Promise<PendingAction[]>;

  /**
   * Una acción `proposed` de la clave (la primera de su lote), caducada o no
   * (quien llama decide qué decir si ya caducó). Confirmarla confirma su lote entero.
   */
  findProposed(contextKey: string): Promise<PendingAction | undefined>;

  findById(id: string): Promise<PendingAction | undefined>;

  /**
   * Reclama la acción para ejecutarla: `proposed` → `executing` de forma atómica,
   * así que de dos confirmaciones simultáneas solo una la recibe. `undefined` = ya
   * ejecutada o en curso, cancelada, caducada o de otra clave.
   */
  claimForExecution(id: string, contextKey: string): Promise<PendingAction | undefined>;

  markExecuted(id: string, result: unknown): Promise<void>;

  markFailed(id: string, error: string): Promise<void>;

  /**
   * Vuelve a dejar como propuestas, con la caducidad renovada a `ttlMin` minutos,
   * las acciones que aún no se han hecho (la que se ejecutaba y las que esperaban
   * su turno en el lote). Las ya hechas, fallidas o retiradas no se tocan.
   */
  reopenProposed(ids: readonly string[], ttlMin: number): Promise<void>;

  /**
   * Retira el lote vivo de la clave entero (el usuario dijo «cancelar»). Devuelve
   * una de las retiradas, con su estado final (`cancelled`, o `expired` si llegó tarde).
   */
  cancelProposed(contextKey: string): Promise<PendingAction | undefined>;

  /** ¿Se ejecutó alguna acción de esta clave en los últimos `withinMin` minutos? */
  executedRecently(contextKey: string, withinMin: number): Promise<boolean>;
}
