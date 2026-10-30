import { describe, it, expect } from 'vitest';
import { csvBytes, csvCell } from './csv.js';

// Espacios Unicode que no se ven en el código: espacio duro, espacio ideográfico y espacio eme.
const NBSP = String.fromCharCode(0xa0);
const IDEOGRAFICO = String.fromCharCode(0x3000);
const EME = String.fromCharCode(0x2003);

describe('csvCell', () => {
  it('entrecomilla y dobla las comillas si la celda lleva ;, comillas o saltos de línea', () => {
    expect(csvCell('a;b')).toBe('"a;b"');
    expect(csvCell('dijo "hola"')).toBe('"dijo ""hola"""');
    expect(csvCell('línea 1\nlínea 2')).toBe('"línea 1\nlínea 2"');
    expect(csvCell('normal')).toBe('normal');
  });

  it('neutraliza fórmulas: texto que empieza por =, +, -, @ lleva un apóstrofo delante', () => {
    expect(csvCell('=1+1')).toBe("'=1+1");
    expect(csvCell('=HYPERLINK("http://x","clic")')).toBe(`"'=HYPERLINK(""http://x"",""clic"")"`);
    expect(csvCell('-2+3')).toBe("'-2+3");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
  });

  it('un teléfono escrito como texto («+34 600…») también se neutraliza: empieza por +', () => {
    expect(csvCell('+34 600 111 222')).toBe("'+34 600 111 222");
    expect(csvCell('+34600111222')).toBe("'+34600111222");
  });

  it('neutraliza la fórmula aunque lleve espacios en blanco delante', () => {
    expect(csvCell(' =1+1')).toBe("' =1+1");
    expect(csvCell('   -2+3')).toBe("'   -2+3");
    expect(csvCell(`${NBSP}=1+1`)).toBe(`'${NBSP}=1+1`);
    expect(csvCell(`${IDEOGRAFICO}@SUM(A1)`)).toBe(`'${IDEOGRAFICO}@SUM(A1)`);
    expect(csvCell(`${EME}+1`)).toBe(`'${EME}+1`);
    // Con tabulador, CR o salto delante, además va entre comillas.
    expect(csvCell('\t=1+1')).toBe(`"'\t=1+1"`);
    expect(csvCell('\r=1')).toBe(`"'\r=1"`);
    expect(csvCell('\n=1+1')).toBe(`"'\n=1+1"`);
    expect(csvCell(' \t =1+1')).toBe(`"' \t =1+1"`);
  });

  it('neutraliza toda celda que empiece por tabulador o retorno de carro, lleve lo que lleve', () => {
    expect(csvCell('\tNave 3')).toBe(`"'\tNave 3"`);
    expect(csvCell('\rNave 3')).toBe(`"'\rNave 3"`);
  });

  it('el texto normal queda intacto, también con espacios o signos que no van al principio', () => {
    expect(csvCell('Juan Pérez')).toBe('Juan Pérez');
    expect(csvCell('Entrada principal')).toBe('Entrada principal');
    expect(csvCell(' Entrada')).toBe(' Entrada');
    expect(csvCell('Nave 3 - muelle')).toBe('Nave 3 - muelle');
    expect(csvCell('ana@acme.com')).toBe('ana@acme.com');
    expect(csvCell('2+2=4')).toBe('2+2=4');
    expect(csvCell('')).toBe('');
  });

  // Corrección respecto al bot: con la coma como separador de lista, Excel parte la fila por comas
  // y el fragmento tras la coma se ejecutaría como fórmula.
  it('entrecomilla las celdas con coma o tabulador: «Nave,=1+1» sale como una sola celda', () => {
    expect(csvCell('Nave,=1+1')).toBe('"Nave,=1+1"');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('a\tb')).toBe('"a\tb"');
    expect(csvCell('=A1,B1')).toBe(`"'=A1,B1"`);
  });

  it('los números no se sanean: un negativo legítimo sale tal cual', () => {
    expect(csvCell(-5)).toBe('-5');
    expect(csvCell(-0.5)).toBe('-0.5');
    expect(csvCell(42)).toBe('42');
  });

  it('los vacíos salen como celda vacía', () => {
    expect(csvCell(undefined)).toBe('');
    expect(csvCell(null)).toBe('');
  });
});

describe('csvBytes', () => {
  it('UTF-8 con BOM, separador ; y CRLF; cada celda pasa por el mismo saneado', () => {
    const bytes = csvBytes(['A', 'B', 'C'], [[' =1+1', -3, null]]);
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(bytes.subarray(3).toString('utf8')).toBe("A;B;C\r\n' =1+1;-3;\r\n");
  });
});
