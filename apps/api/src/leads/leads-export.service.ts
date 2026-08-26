import { Injectable } from '@nestjs/common';
import type { LeadDto, LeadExportFormat } from '@dentaltrack/shared';
import * as ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';

/** Arquivo pronto para download (GET /leads/export). */
export interface LeadExportFile {
  buffer: Buffer;
  contentType: string;
  filename: string;
}

const STATUS_LABELS: Record<string, string> = {
  em_andamento: 'Em andamento',
  agendada: 'Agendada',
  abandonada: 'Não completada',
};

const SOURCE_LABELS: Record<string, string> = {
  web: 'Web',
  whatsapp: 'WhatsApp',
  manual: 'Manual',
  import: 'Importado',
};

const TEMPERATURE_LABELS: Record<string, string> = {
  quente: 'Quente',
  medio: 'Médio',
  fraco: 'Fraco',
};

const HEADER = [
  'Nome',
  'Telefone',
  'E-mail',
  'Interesse',
  'Tags',
  'Status',
  'Origem',
  'Temperatura',
  'Score',
  'Capturado em',
];

/**
 * Exportação de leads (F8 · GET /leads/export). Gera o arquivo em memória a
 * partir dos DTOs já derivados pelo LeadsService (mesmos dados da tela):
 * CSV (UTF-8 + BOM), XLSX (exceljs) ou PDF (pdfkit, A4 paisagem). Volumes do
 * MVP (centenas de leads) cabem em buffer sem streaming.
 */
@Injectable()
export class LeadsExportService {
  async export(
    leads: LeadDto[],
    format: LeadExportFormat,
    clinicName?: string,
  ): Promise<LeadExportFile> {
    const date = new Date().toISOString().slice(0, 10);
    if (format === 'csv') {
      return {
        buffer: this.toCsv(leads),
        contentType: 'text/csv; charset=utf-8',
        filename: `leads-${date}.csv`,
      };
    }
    if (format === 'xlsx') {
      return {
        buffer: await this.toXlsx(leads),
        contentType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        filename: `leads-${date}.xlsx`,
      };
    }
    return {
      buffer: await this.toPdf(leads, clinicName),
      contentType: 'application/pdf',
      filename: `leads-${date}.pdf`,
    };
  }

  private rows(leads: LeadDto[]): string[][] {
    return leads.map((l) => [
      l.name ?? '',
      l.phone ?? '',
      l.email ?? '',
      l.interest ?? '',
      l.tags.map((t) => t.name).join('; '),
      l.status ? (STATUS_LABELS[l.status] ?? l.status) : '',
      SOURCE_LABELS[l.source] ?? l.source,
      TEMPERATURE_LABELS[l.temperature] ?? l.temperature,
      String(l.score),
      new Date(l.createdAt).toLocaleString('pt-BR', {
        timeZone: 'America/Sao_Paulo',
      }),
    ]);
  }

  private toCsv(leads: LeadDto[]): Buffer {
    const escape = (v: string) =>
      /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
    const csv = [HEADER, ...this.rows(leads)]
      .map((r) => r.map(escape).join(','))
      .join('\n');
    // BOM → Excel abre UTF-8 com acentos corretos.
    return Buffer.from('﻿' + csv, 'utf8');
  }

  private async toXlsx(leads: LeadDto[]): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'DentalTrack';
    const sheet = workbook.addWorksheet('Leads');
    sheet.columns = HEADER.map((header, i) => ({
      header,
      key: String(i),
      width: [26, 18, 28, 22, 30, 16, 12, 12, 8, 20][i],
    }));
    for (const row of this.rows(leads)) sheet.addRow(row);
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  private toPdf(leads: LeadDto[], clinicName?: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'A4',
        layout: 'landscape',
        margin: 36,
      });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Colunas do PDF (sem score/temperatura — cabem as 8 principais).
      const columns = [
        { label: 'Nome', width: 130 },
        { label: 'Telefone', width: 95 },
        { label: 'E-mail', width: 130 },
        { label: 'Interesse', width: 90 },
        { label: 'Tags', width: 110 },
        { label: 'Status', width: 75 },
        { label: 'Origem', width: 55 },
        { label: 'Capturado em', width: 85 },
      ];
      const startX = doc.page.margins.left;
      const bottom = doc.page.height - doc.page.margins.bottom;

      const drawHeader = () => {
        doc.font('Helvetica-Bold').fontSize(8.5);
        let x = startX;
        const y = doc.y;
        for (const col of columns) {
          doc.text(col.label, x, y, { width: col.width - 8 });
          x += col.width;
        }
        doc
          .moveTo(startX, doc.y + 3)
          .lineTo(startX + columns.reduce((s, c) => s + c.width, 0), doc.y + 3)
          .strokeColor('#999999')
          .stroke();
        doc.y += 8;
        doc.font('Helvetica').fontSize(8.5);
      };

      doc.font('Helvetica-Bold').fontSize(14);
      doc.text(clinicName ? `Leads — ${clinicName}` : 'Leads', startX, doc.y);
      doc.font('Helvetica').fontSize(9).fillColor('#555555');
      doc.text(
        `Exportado em ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} · ${leads.length} lead(s)`,
      );
      doc.fillColor('#000000');
      doc.y += 10;
      drawHeader();

      for (const row of this.rows(leads)) {
        const cells = [
          row[0],
          row[1],
          row[2],
          row[3],
          row[4],
          row[5],
          row[6],
          row[9],
        ];
        const heights = cells.map((cell, i) =>
          doc.heightOfString(cell || '—', { width: columns[i].width - 8 }),
        );
        const rowHeight = Math.max(...heights) + 6;
        if (doc.y + rowHeight > bottom) {
          doc.addPage();
          doc.y = doc.page.margins.top;
          drawHeader();
        }
        let x = startX;
        const y = doc.y;
        cells.forEach((cell, i) => {
          doc.text(cell || '—', x, y, { width: columns[i].width - 8 });
          x += columns[i].width;
        });
        doc.y = y + rowHeight;
      }

      doc.end();
    });
  }
}
