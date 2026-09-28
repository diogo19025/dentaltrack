import { BadRequestException, Injectable } from '@nestjs/common';
import type { LeadImportResult } from '@dentaltrack/shared';
import * as ExcelJS from 'exceljs';
import { inflateRawSync } from 'node:zlib';
import { PrismaService } from '../prisma/prisma.service';

/** Linha da planilha já mapeada para os campos do Lead. */
interface ParsedRow {
  line: number;
  name: string | null;
  phone: string | null;
  email: string | null;
}

/** Linha crua da planilha com o nº real no arquivo (1-based, como no Excel). */
interface GridRow {
  line: number;
  cells: string[];
}

const MAX_ROWS = 2000;
const MAX_ERRORS = 20;

/** Cabeçalhos aceitos (normalizados: minúsculas, sem acento). */
const NAME_HEADERS = ['nome', 'name', 'lead', 'paciente', 'cliente', 'contato'];
const PHONE_HEADERS = [
  'telefone',
  'phone',
  'celular',
  'whatsapp',
  'fone',
  'tel',
];
const EMAIL_HEADERS = ['email', 'e-mail', 'mail'];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Importação de leads por planilha (F8 · POST /leads/import). Aceita .xlsx
 * (exceljs) ou .csv; a 1ª linha é o cabeçalho e o mapeamento de colunas é
 * flexível (Nome/Telefone/E-mail em PT ou EN, qualquer ordem — colunas extras
 * são ignoradas). Regras: cada linha precisa de ao menos um contato (telefone
 * ou e-mail) ou nome; duplicatas (mesmo telefone normalizado ou e-mail, na
 * clínica ou dentro do arquivo) são puladas; leads criados com
 * `source="import"`. Multi-tenant: tudo escopado por `clinicId`.
 */
@Injectable()
export class LeadsImportService {
  constructor(private readonly prisma: PrismaService) {}

  async import(
    clinicId: string,
    file: { originalname?: string; mimetype?: string; buffer: Buffer },
  ): Promise<LeadImportResult> {
    const rows = await this.parse(file);
    if (rows.length === 0) {
      throw new BadRequestException(
        'Planilha vazia — nenhuma linha de dados encontrada abaixo do cabeçalho.',
      );
    }
    if (rows.length > MAX_ROWS) {
      throw new BadRequestException(
        `Planilha muito grande (${rows.length} linhas) — o limite por importação é ${MAX_ROWS}.`,
      );
    }

    // Índice de duplicatas existentes na clínica (telefone só-dígitos / e-mail).
    const existing = await this.prisma.lead.findMany({
      where: { clinicId },
      select: { phone: true, email: true },
    });
    const phones = new Set<string>();
    const emails = new Set<string>();
    for (const lead of existing) {
      const digits = normalizePhone(lead.phone);
      if (digits) phones.add(digits);
      if (lead.email) emails.add(lead.email.trim().toLowerCase());
    }

    const result: LeadImportResult = {
      total: rows.length,
      imported: 0,
      duplicates: 0,
      invalid: 0,
      errors: [],
    };
    const toCreate: {
      clinicId: string;
      name: string | null;
      phone: string | null;
      email: string | null;
      source: string;
    }[] = [];

    for (const row of rows) {
      const email = row.email?.trim().toLowerCase() || null;
      const phoneDigits = normalizePhone(row.phone);

      if (!row.name && !phoneDigits && !email) {
        result.invalid += 1;
        pushError(result, row.line, 'Linha sem nome, telefone ou e-mail.');
        continue;
      }
      if (email && !EMAIL_RE.test(email)) {
        result.invalid += 1;
        pushError(result, row.line, `E-mail inválido: "${row.email}".`);
        continue;
      }
      if (phoneDigits && (phoneDigits.length < 8 || phoneDigits.length > 15)) {
        result.invalid += 1;
        pushError(result, row.line, `Telefone inválido: "${row.phone}".`);
        continue;
      }
      if (
        (phoneDigits && phones.has(phoneDigits)) ||
        (email && emails.has(email))
      ) {
        result.duplicates += 1;
        continue;
      }

      if (phoneDigits) phones.add(phoneDigits);
      if (email) emails.add(email);
      toCreate.push({
        clinicId,
        name: row.name,
        phone: row.phone?.trim() || null,
        email,
        source: 'import',
      });
    }

    if (toCreate.length > 0) {
      await this.prisma.lead.createMany({ data: toCreate });
    }
    result.imported = toCreate.length;
    return result;
  }

  /** Detecta o formato pelo nome/mimetype e devolve as linhas mapeadas. */
  private async parse(file: {
    originalname?: string;
    mimetype?: string;
    buffer: Buffer;
  }): Promise<ParsedRow[]> {
    const name = (file.originalname ?? '').toLowerCase();
    const isXlsx =
      name.endsWith('.xlsx') ||
      file.mimetype ===
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    const isCsv =
      name.endsWith('.csv') ||
      file.mimetype === 'text/csv' ||
      file.mimetype === 'application/vnd.ms-excel';
    if (!isXlsx && !isCsv) {
      throw new BadRequestException(
        'Formato não suportado — envie uma planilha .xlsx ou .csv.',
      );
    }
    const grid = isXlsx
      ? await this.readXlsx(file.buffer)
      : readCsv(file.buffer);
    return mapGrid(grid);
  }

  /**
   * O `workbook.xlsx.load()` descompacta o arquivo inteiro na memória antes de
   * o limite de linhas ser conferido. Um .xlsx é um zip, e 5 MB de zip podem
   * virar gigabytes de XML: um arquivo feito para isso derrubava a API por
   * falta de memória, e a API é a mesma para todas as empresas. Por isso o
   * zip passa antes por `assertZipWithinLimits`, que mede o tamanho real.
   */
  private async readXlsx(buffer: Buffer): Promise<GridRow[]> {
    assertZipWithinLimits(buffer);
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    } catch {
      throw new BadRequestException(
        'Não foi possível ler o arquivo .xlsx — ele está corrompido ou não é um Excel válido.',
      );
    }
    const sheet = workbook.worksheets[0];
    if (!sheet) return [];
    const grid: GridRow[] = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      // Normaliza richText/fórmulas/hyperlinks para texto.
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        cells[col - 1] = cellText(cell);
      });
      grid.push({
        line: row.number,
        cells: Array.from(cells, (c) => c ?? ''),
      });
    });
    return grid;
  }
}

/**
 * Teto do conteúdo descompactado de um .xlsx aceito na importação. Uma
 * planilha de 2000 linhas de contato fica na casa de 1 MB descompactada.
 */
export const MAX_XLSX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;

const ZIP_END_OF_CENTRAL_DIR = 0x06054b50;
const ZIP_CENTRAL_ENTRY = 0x02014b50;
const ZIP_LOCAL_ENTRY = 0x04034b50;

/**
 * Descompacta cada entrada do zip com teto de saída e recusa o arquivo se o
 * total passar de `MAX_XLSX_UNCOMPRESSED_BYTES`.
 *
 * O tamanho declarado no diretório do zip não serve: quem monta o arquivo
 * escreve o número que quiser ali. O `maxOutputLength` do zlib para a
 * descompactação no teto, então a memória usada aqui nunca passa dele, e só
 * depois disso o exceljs abre o arquivo. Isso custa descompactar duas vezes
 * um arquivo que já é pequeno.
 *
 * O leitor em streaming do exceljs não resolve: ele grava as abas em arquivo
 * temporário quando o `sharedStrings.xml` vem depois delas, o que só mudaria o
 * problema da memória para o disco.
 */
export function assertZipWithinLimits(buffer: Buffer): void {
  const corrupted = new BadRequestException(
    'Não foi possível ler o arquivo .xlsx — ele está corrompido ou não é um Excel válido.',
  );
  const tooBig = new BadRequestException(
    'Planilha muito grande depois de descompactada. Divida o arquivo em partes menores.',
  );

  // Fim do diretório central: nos últimos 22 bytes + comentário (até 64 KB).
  const floor = Math.max(0, buffer.length - 22 - 0xffff);
  let eocd = -1;
  for (let i = buffer.length - 22; i >= floor; i--) {
    if (buffer.readUInt32LE(i) === ZIP_END_OF_CENTRAL_DIR) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw corrupted;

  const entries = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  let budget = MAX_XLSX_UNCOMPRESSED_BYTES;

  for (let n = 0; n < entries; n++) {
    if (
      offset + 46 > buffer.length ||
      buffer.readUInt32LE(offset) !== ZIP_CENTRAL_ENTRY
    ) {
      throw corrupted;
    }
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const localOffset = buffer.readUInt32LE(offset + 42);
    // Zip64: nenhuma planilha de 5 MB precisa dele.
    if (compressedSize === 0xffffffff || localOffset === 0xffffffff) {
      throw tooBig;
    }

    if (
      localOffset + 30 > buffer.length ||
      buffer.readUInt32LE(localOffset) !== ZIP_LOCAL_ENTRY
    ) {
      throw corrupted;
    }
    const dataStart =
      localOffset +
      30 +
      buffer.readUInt16LE(localOffset + 26) +
      buffer.readUInt16LE(localOffset + 28);
    const data = buffer.subarray(dataStart, dataStart + compressedSize);

    let size: number;
    if (method === 0) {
      size = data.length; // armazenado sem compressão
    } else if (method === 8) {
      try {
        size = inflateRawSync(data, { maxOutputLength: budget + 1 }).length;
      } catch (err) {
        // O código, e não `instanceof RangeError`: o erro pode vir de outro
        // realm (o Jest roda o código num contexto próprio).
        if ((err as { code?: unknown }).code === 'ERR_BUFFER_TOO_LARGE') {
          throw tooBig;
        }
        throw corrupted;
      }
    } else {
      throw corrupted;
    }

    budget -= size;
    if (budget < 0) throw tooBig;

    offset +=
      46 +
      buffer.readUInt16LE(offset + 28) +
      buffer.readUInt16LE(offset + 30) +
      buffer.readUInt16LE(offset + 32);
  }
}

/** Texto de uma célula do exceljs (string, número, data, richText, fórmula…). */
function cellText(cell: ExcelJS.Cell): string {
  const value = cell.value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    if ('richText' in value)
      return value.richText
        .map((r) => r.text)
        .join('')
        .trim();
    if ('text' in value && typeof value.text === 'string')
      return value.text.trim();
    if ('result' in value) {
      const result = value.result;
      if (
        typeof result === 'string' ||
        typeof result === 'number' ||
        typeof result === 'boolean'
      )
        return String(result).trim();
    }
  }
  return String(cell.text ?? '').trim();
}

/** Parser CSV mínimo com suporte a aspas (RFC 4180) e detecção de , ou ;. */
function readCsv(buffer: Buffer): GridRow[] {
  let text = buffer.toString('utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // BOM
  const firstLine = text.slice(0, text.indexOf('\n'));
  const delimiter =
    (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0)
      ? ';'
      : ',';

  const rows: GridRow[] = [];
  let line = 1;
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const endRow = () => {
    row.push(field);
    field = '';
    // Linhas 100% vazias não viram dados, mas contam na numeração (Excel).
    if (row.some((c) => c.trim() !== '')) {
      rows.push({ line, cells: row.map((c) => c.trim()) });
    }
    row = [];
    line += 1;
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      endRow();
    } else field += ch;
  }
  endRow();
  return rows;
}

/** Localiza as colunas pelo cabeçalho e mapeia as linhas de dados. */
function mapGrid(grid: GridRow[]): ParsedRow[] {
  if (grid.length === 0) return [];
  const header = grid[0].cells.map(normalizeHeader);
  const nameIdx = header.findIndex((h) => NAME_HEADERS.includes(h));
  const phoneIdx = header.findIndex((h) => PHONE_HEADERS.includes(h));
  const emailIdx = header.findIndex((h) => EMAIL_HEADERS.includes(h));
  if (nameIdx === -1 && phoneIdx === -1 && emailIdx === -1) {
    throw new BadRequestException(
      'Cabeçalho não reconhecido — a 1ª linha precisa ter ao menos uma coluna ' +
        '"Nome", "Telefone" ou "E-mail".',
    );
  }
  return grid.slice(1).map(({ line, cells }) => ({
    name: pick(cells, nameIdx),
    phone: pick(cells, phoneIdx),
    email: pick(cells, emailIdx),
    line,
  }));
}

function pick(cells: string[], idx: number): string | null {
  if (idx === -1) return null;
  const value = (cells[idx] ?? '').trim();
  return value === '' ? null : value;
}

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Só dígitos (mín. 8 p/ valer como telefone); null se vazio. */
function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  return digits === '' ? null : digits;
}

function pushError(result: LeadImportResult, line: number, reason: string) {
  if (result.errors.length < MAX_ERRORS) result.errors.push({ line, reason });
}
