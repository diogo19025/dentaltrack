import type { LeadDto } from '@dentaltrack/shared';
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
