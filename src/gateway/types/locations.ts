export interface LocationRef {
  id: string;
  name: string;
  /** Dirección postal (obligatoria en el backend); ausente o null si no se conoce. */
  address?: string | null;
}
