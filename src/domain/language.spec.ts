import { describe, it, expect } from 'vitest';
import {
  baseLanguage,
  detectLanguage,
  fixedTextLanguage,
  resolveReplyLanguage,
} from './language.js';

describe('baseLanguage', () => {
  it('reduce un locale de Meta a su idioma base', () => {
    expect(baseLanguage('es_MX')).toBe('es');
    expect(baseLanguage('en_US')).toBe('en');
    expect(baseLanguage('pt-BR')).toBe('pt');
  });

  it('deja intacto un idioma que ya es base', () => {
    expect(baseLanguage('es')).toBe('es');
    expect(baseLanguage('fr')).toBe('fr');
  });

  it('normaliza a minúsculas', () => {
    expect(baseLanguage('ES_mx')).toBe('es');
  });
});

describe('detectLanguage', () => {
  it('detecta inglés en frases cortas sin saludo', () => {
    for (const text of [
      'Sorry for the late answer',
      'I was only testing it',
      'Thanks for checking by the way',
      'The app is working now',
    ]) {
      expect(detectLanguage(text), text).toBe('en');
    }
  });

  it('detecta español', () => {
    expect(detectLanguage('Hola, no me funciona la app')).toBe('es');
    expect(detectLanguage('¿Cuánto cuesta?')).toBe('es');
    expect(detectLanguage('Buenos días, tengo un problema con los vigilantes')).toBe('es');
  });

  it('detecta francés', () => {
    expect(detectLanguage("Bonjour, j'ai un problème avec l'application")).toBe('fr');
    expect(detectLanguage('Merci beaucoup')).toBe('fr');
    expect(detectLanguage('Ça ne marche pas')).toBe('fr');
  });

  it('devuelve null si el texto es demasiado corto o no dice nada del idioma', () => {
    for (const text of ['ok', '👍', '12345', '', '   ', 'Gracias', 'QR']) {
      expect(detectLanguage(text), text).toBeNull();
    }
  });

  // Sin esto, «Hi» no decidía y ganaba el idioma guardado del contacto.
  it('un saludo inequívoco basta para decidir el idioma', () => {
    expect(detectLanguage('Hi')).toBe('en');
    expect(detectLanguage('Hello!')).toBe('en');
    expect(detectLanguage('Hola')).toBe('es');
    expect(detectLanguage('Bonjour')).toBe('fr');
    expect(detectLanguage('salut')).toBe('fr');
  });

  it('devuelve null si no hay un ganador claro', () => {
    // "de" y "la" son a la vez español y francés
    expect(detectLanguage('de la')).toBeNull();
  });

  it('no se deja arrastrar por las marcas de adjunto ni por la lectura de imágenes, que el sistema escribe en español', () => {
    expect(detectLanguage('[El usuario ha enviado una imagen]')).toBeNull();
    expect(
      detectLanguage(
        'Look at this\n<<adjunto_del_cliente>>\nContenido de la imagen: una pantalla con un mensaje de error en el panel\n<</adjunto_del_cliente>>'
      )
    ).toBe('en');
    // la transcripción de un audio SÍ son palabras del cliente
    expect(
      detectLanguage(
        '<<adjunto_del_cliente>>\nTranscripción del audio: «Hello, I cannot see the rounds in the app»\n<</adjunto_del_cliente>>'
      )
    ).toBe('en');
  });
});

describe('resolveReplyLanguage', () => {
  it('el cliente escribe en inglés aunque su contacto figure en español → inglés', () => {
    expect(
      resolveReplyLanguage(
        [
          'Sorry for the late answer',
          'I was only testing it',
          'Thanks for checking by the way',
          'The app is working now',
        ],
        'es'
      )
    ).toBe('en');
  });

  it('manda el último mensaje del cliente si se puede decidir', () => {
    expect(
      resolveReplyLanguage(['Hola, tengo un problema con la app', 'Thanks for your help'], 'es')
    ).toBe('en');
  });

  it('si el último no decide, usa sus últimos 3 mensajes juntos', () => {
    expect(resolveReplyLanguage(['Hola, tengo un problema con la app', 'ok'], 'en')).toBe('es');
    expect(resolveReplyLanguage(['Hello there', 'I need', 'help'], null)).toBe('en');
  });

  it('si los mensajes no deciden, usa el idioma (base) del contacto', () => {
    expect(resolveReplyLanguage(['ok'], 'en')).toBe('en');
    expect(resolveReplyLanguage(['👍'], 'fr_FR')).toBe('fr');
  });

  it('sin nada que decida, o con un idioma de contacto no soportado, español', () => {
    expect(resolveReplyLanguage(['ok'], null)).toBe('es');
    expect(resolveReplyLanguage(['Hi'], 'fr')).toBe('en');
    expect(resolveReplyLanguage([], null)).toBe('es');
    expect(resolveReplyLanguage(['ok'], 'pt')).toBe('es');
  });
});

describe('fixedTextLanguage', () => {
  it('los textos fijos existen en los tres idiomas de respuesta: el francés ya no cae al inglés', () => {
    expect(fixedTextLanguage('es')).toBe('es');
    expect(fixedTextLanguage('en')).toBe('en');
    expect(fixedTextLanguage('fr')).toBe('fr');
  });
});
