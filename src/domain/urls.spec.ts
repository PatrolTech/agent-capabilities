import { describe, it, expect } from 'vitest';
import { DEFAULT_URLS, resolveUrls } from './urls.js';

describe('resolveUrls', () => {
  it('sin nada, los de producción', () => {
    expect(resolveUrls()).toEqual({
      app: 'https://app.patroltech.online',
      dashboard: 'https://dashboard.patroltech.online',
      license: 'https://dashboard.patroltech.online/license',
    });
    expect(resolveUrls()).toEqual(DEFAULT_URLS);
  });

  it('con otro panel y sin Licencia, la Licencia es la de ESE panel', () => {
    expect(resolveUrls({ dashboard: 'https://panel.staging.test' })).toEqual({
      app: 'https://app.patroltech.online',
      dashboard: 'https://panel.staging.test',
      license: 'https://panel.staging.test/license',
    });
  });

  it('cada enlace que se da manda sobre su valor por defecto', () => {
    const urls = { app: 'a', dashboard: 'd', license: 'l' };
    expect(resolveUrls(urls)).toEqual(urls);
  });
});
