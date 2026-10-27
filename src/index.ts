// Contexto de sesión común a lecturas y acciones (organización canónica y anti-fuga)
export * from './context.js';

// Dependencias comunes del catálogo (gateway, logger, enlaces)
export * from './deps.js';
export * from './domain/urls.js';

// Puertos (los implementa cada consumidor)
export * from './ports/Logger.js';
export * from './ports/FileSink.js';
export * from './ports/PendingActionStore.js';

// Puerto de la API de PatrolTech y sus tipos (el fake va en ./testing)
export * from './gateway/index.js';

// Dominio puro
export * from './domain/language.js';
export * from './domain/incident-status.js';
export * from './domain/resolve-by-name.js';
export * from './domain/scan-explanation.js';
export * from './domain/route-schedule.js';
export * from './domain/route-checkpoints.js';
export * from './domain/geo.js';
export * from './domain/backend-errors.js';
export * from './domain/qr-image.js';
export * from './domain/guard-app-message.js';
export * from './domain/date-range.js';
export * from './domain/timezone.js';
export * from './domain/scans-csv.js';
export * from './domain/access-logs-csv.js';
export * from './domain/tool-result.js';
export * from './domain/puesta-en-marcha.js';
export * from './domain/country.js';
export * from './domain/money.js';

// Capacidades de lectura
export * from './reads/index.js';

// Acciones de escritura (propuesta y confirmación)
export * from './actions/index.js';

// Catálogo único: metadatos, canales y filtro por canal
export * from './catalog/types.js';
export * from './catalog/entries.js';
export * from './catalog/buildCatalog.js';
export * from './catalog/english.js';
