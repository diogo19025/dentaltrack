import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as ExcelJS from 'exceljs';
import { deflateRawSync } from 'node:zlib';
import { PrismaService } from '../prisma/prisma.service';
import {
  LeadsImportService,
  MAX_XLSX_UNCOMPRESSED_BYTES,
  assertZipWithinLimits,
} from './leads-import.service';

const CLINIC = '00000000-0000-0000-0000-0000000c1141';

function csvFile(content: string, name = 'leads.csv') {
  return {
    originalname: name,
    mimetype: 'text/csv',
    buffer: Buffer.from(content, 'utf8'),
  };
}

async function xlsxFile(rows: (string | number)[][]) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Planilha1');
  for (const row of rows) sheet.addRow(row);
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  return {
    originalname: 'leads.xlsx',
    mimetype:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer,
  };
}

describe('LeadsImportService', () => {
  let service: LeadsImportService;
  const prismaMock = {
    lead: { findMany: jest.fn(), createMany: jest.fn() },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    prismaMock.lead.findMany.mockResolvedValue([]);
    prismaMock.lead.createMany.mockResolvedValue({ count: 0 });
    const moduleRef = await Test.createTestingModule({
      providers: [
        LeadsImportService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();
    service = moduleRef.get(LeadsImportService);
  });

  it('importa CSV com cabeçalho PT-BR (colunas em qualquer ordem, extras ignoradas)', async () => {
    const result = await service.import(
      CLINIC,
      csvFile(
        'Cidade,Telefone,Nome,E-mail\n' +
          'SP,(11) 91111-1111,Ana,ana@ex.com\n' +
          'RJ,(21) 92222-2222,Bruno,',
      ),
    );
    expect(result).toMatchObject({
      total: 2,
      imported: 2,
      duplicates: 0,
      invalid: 0,
    });
    expect(prismaMock.lead.createMany).toHaveBeenCalledWith({
      data: [
        {
          clinicId: CLINIC,
          name: 'Ana',
          phone: '(11) 91111-1111',
          email: 'ana@ex.com',
          source: 'import',
        },
        {
          clinicId: CLINIC,
          name: 'Bruno',
          phone: '(21) 92222-2222',
          email: null,
          source: 'import',
        },
      ],
    });
  });

  it('importa CSV separado por ponto e vírgula (Excel PT-BR)', async () => {
    const result = await service.import(
      CLINIC,
      csvFile('Nome;Telefone\nCarla;(31) 93333-3333\n'),
    );
    expect(result.imported).toBe(1);
  });

  it('importa XLSX gerado pelo Excel', async () => {
    const file = await xlsxFile([
      ['Nome', 'Celular', 'Email'],
      ['Diego', '(41) 94444-4444', 'diego@ex.com'],
    ]);
    const result = await service.import(CLINIC, file);
    expect(result).toMatchObject({ total: 1, imported: 1 });
    expect(prismaMock.lead.createMany).toHaveBeenCalledWith({
      data: [
        {
          clinicId: CLINIC,
          name: 'Diego',
          phone: '(41) 94444-4444',
          email: 'diego@ex.com',
          source: 'import',
        },
      ],
    });
  });

  it('pula duplicatas da clínica (telefone normalizado / e-mail) e dentro do arquivo', async () => {
    prismaMock.lead.findMany.mockResolvedValue([
      { phone: '11911111111', email: null },
      { phone: null, email: 'ana@ex.com' },
    ]);
    const result = await service.import(
      CLINIC,
      csvFile(
        'Nome,Telefone,E-mail\n' +
          'Ana,(11) 91111-1111,\n' + // telefone já existe (formatação diferente)
          'Ana Maria,,ANA@ex.com\n' + // e-mail já existe (case diferente)
          'Novo,(51) 95555-5555,\n' +
          'Repetido,(51) 95555-5555,', // duplicata dentro do arquivo
      ),
    );
    expect(result).toMatchObject({
      total: 4,
      imported: 1,
      duplicates: 3,
      invalid: 0,
    });
  });

  it('rejeita linhas inválidas com o número da linha (sem contato / e-mail ruim / telefone curto)', async () => {
    const result = await service.import(
      CLINIC,
      csvFile(
        'Nome,Telefone,E-mail\n' +
          ',,\n' + // ignorada (linha vazia não vira row)
          'Eva,,nao-e-email\n' +
          'Gil,123,\n' +
          'Ok,(61) 96666-6666,',
      ),
    );
    expect(result).toMatchObject({ total: 3, imported: 1, invalid: 2 });
    expect(result.errors).toEqual([
      { line: 3, reason: expect.stringContaining('E-mail inválido') },
      { line: 4, reason: expect.stringContaining('Telefone inválido') },
    ]);
  });

  it('recusa cabeçalho sem colunas reconhecidas', async () => {
    await expect(
      service.import(CLINIC, csvFile('Foo,Bar\n1,2')),
    ).rejects.toThrow(BadRequestException);
  });

  it('recusa formato não suportado e planilha vazia', async () => {
    await expect(
      service.import(CLINIC, {
        originalname: 'leads.txt',
        mimetype: 'text/plain',
        buffer: Buffer.from('oi'),
      }),
    ).rejects.toThrow('Formato não suportado');
    await expect(
      service.import(CLINIC, csvFile('Nome,Telefone\n')),
    ).rejects.toThrow('Planilha vazia');
  });

  it('não chama createMany quando nada é importável', async () => {
    prismaMock.lead.findMany.mockResolvedValue([
      { phone: '11911111111', email: null },
    ]);
    const result = await service.import(
      CLINIC,
      csvFile('Nome,Telefone\nAna,11911111111'),
    );
    expect(result.imported).toBe(0);
    expect(prismaMock.lead.createMany).not.toHaveBeenCalled();
  });
});

/**
 * Zip mínimo com uma entrada deflate. `declaredSize` permite forjar o tamanho
 * descompactado no diretório central, que é o que um arquivo malicioso faz.
 */
function zipWith(raw: Buffer, declaredSize = raw.length): Buffer {
  const name = Buffer.from('xl/worksheets/sheet1.xml');
  const data = deflateRawSync(raw);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(8, 8); // deflate
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(declaredSize, 22);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(declaredSize, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(0, 42); // local header no início
  const centralOffset = local.length + name.length + data.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12);
  end.writeUInt32LE(centralOffset, 16);
  return Buffer.concat([local, name, data, central, name, end]);
}

describe('assertZipWithinLimits (zip bomb na importação)', () => {
  const bomb = Buffer.alloc(MAX_XLSX_UNCOMPRESSED_BYTES + 1024, 0x61);

  it('recusa quando o conteúdo real passa do teto', () => {
    expect(() => assertZipWithinLimits(zipWith(bomb))).toThrow(/muito grande/);
  });

  it('mede o tamanho real, não o declarado: forjar o diretório não passa', () => {
    const forged = zipWith(bomb, 100);
    expect(forged.length).toBeLessThan(5 * 1024 * 1024); // cabe no upload
    expect(() => assertZipWithinLimits(forged)).toThrow(/muito grande/);
  });

  it('aceita o zip pequeno e recusa o que não é zip', () => {
    expect(() =>
      assertZipWithinLimits(zipWith(Buffer.from('<x/>'))),
    ).not.toThrow();
    expect(() => assertZipWithinLimits(Buffer.from('não é um zip'))).toThrow(
      /corrompido/,
    );
  });

  it('a importação recusa o arquivo antes de abrir no exceljs', async () => {
    const service = new LeadsImportService({} as unknown as PrismaService);
    await expect(
      service.import(CLINIC, {
        originalname: 'leads.xlsx',
        buffer: zipWith(bomb, 100),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
