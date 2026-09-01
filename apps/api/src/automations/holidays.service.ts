import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { CreateHolidayInput, Holiday } from '@dentaltrack/shared';
import { dateKeyToUtc, zonedDateKey } from '../common/time';
import { PrismaService } from '../prisma/prisma.service';

/** De onde vêm os feriados nacionais. Best-effort: indisponível não quebra nada. */
const NATIONAL_HOLIDAYS_URL = 'https://brasilapi.com.br/api/feriados/v1';
const FETCH_TIMEOUT_MS = 8_000;
/** Validade do cache de datas em memória (o conjunto muda pouquíssimo). */
const CACHE_TTL_MS = 10 * 60_000;

/**
 * Feriados por empresa (F9).
 *
 * O uso principal é **quando não enviar**: um lembrete que cai em feriado é
 * adiado para o próximo dia útil. Os nacionais são sincronizados de uma fonte
 * pública; os **locais são cadastrados à mão** — nenhuma fonte nacional conhece
 * o feriado municipal nem o recesso da clínica, e é justamente esse que fecha a
 * porta.
 */
@Injectable()
export class HolidaysService {
  private readonly logger = new Logger(HolidaysService.name);
  /** `clinicId:ano` → { datas, expiração }. Evita ir ao banco a cada disparo. */
  private readonly cache = new Map<
    string,
    { keys: Set<string>; expiresAt: number }
  >();

  constructor(private readonly prisma: PrismaService) {}

  async list(clinicId: string, year?: number): Promise<Holiday[]> {
    const target = year ?? new Date().getUTCFullYear();
    const rows = await this.prisma.holiday.findMany({
      where: {
        clinicId,
        date: {
          gte: new Date(Date.UTC(target, 0, 1)),
          lt: new Date(Date.UTC(target + 1, 0, 1)),
        },
      },
      orderBy: { date: 'asc' },
    });
    return rows.map((row) => ({
      id: row.id,
      date: row.date.toISOString().slice(0, 10),
      name: row.name,
      scope: row.scope,
    }));
  }

  async create(clinicId: string, input: CreateHolidayInput): Promise<Holiday> {
    const date = new Date(`${input.date}T00:00:00.000Z`);
    const row = await this.prisma.holiday.upsert({
      where: { clinicId_date: { clinicId, date } },
      create: { clinicId, date, name: input.name, scope: 'local' },
      update: { name: input.name, scope: 'local' },
    });
    this.invalidate(clinicId);
    return {
      id: row.id,
      date: row.date.toISOString().slice(0, 10),
      name: row.name,
      scope: row.scope,
    };
  }

  async remove(clinicId: string, id: string): Promise<void> {
    const { count } = await this.prisma.holiday.deleteMany({
      where: { id, clinicId },
    });
    if (count === 0) throw new NotFoundException('Feriado não encontrado.');
    this.invalidate(clinicId);
  }

  /**
   * Este instante cai num feriado da empresa? A comparação é feita pela chave
   * do dia **no fuso da empresa** — perto da meia-noite, UTC e fuso local estão
   * em dias diferentes, e é exatamente aí que o lembrete das 21h erraria.
   */
  async isHoliday(
    clinicId: string,
    date: Date,
    timeZone: string,
  ): Promise<boolean> {
    const key = zonedDateKey(date, timeZone);
    const year = Number(key.slice(0, 4));
    const keys = await this.keysFor(clinicId, year);
    return keys.has(key);
  }

  /**
   * Importa os feriados nacionais do ano para a empresa. Best-effort: se a
   * fonte estiver fora do ar, os feriados locais já cadastrados continuam
   * valendo e a próxima tentativa completa o resto.
   */
  async syncNational(clinicId: string, year: number): Promise<number> {
    let payload: unknown;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(`${NATIONAL_HOLIDAYS_URL}/${year}`, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      payload = await res.json();
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Não foi possível buscar os feriados nacionais de ${year}: ${detail}`,
      );
      return 0;
    } finally {
      clearTimeout(timer);
    }

    if (!Array.isArray(payload)) return 0;

    let imported = 0;
    for (const item of payload) {
      if (typeof item !== 'object' || item === null) continue;
      const raw = item as { date?: unknown; name?: unknown };
      if (typeof raw.date !== 'string' || typeof raw.name !== 'string')
        continue;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(raw.date)) continue;

      const date = new Date(`${raw.date}T00:00:00.000Z`);
      // `create`-only de propósito: um feriado que o dono renomeou ou marcou
      // como dia de trabalho não pode voltar do jeito antigo a cada sincronia.
      const existing = await this.prisma.holiday.findUnique({
        where: { clinicId_date: { clinicId, date } },
        select: { id: true },
      });
      if (existing) continue;

      await this.prisma.holiday.create({
        data: { clinicId, date, name: raw.name, scope: 'nacional' },
      });
      imported += 1;
    }

    if (imported > 0) this.invalidate(clinicId);
    return imported;
  }

  /** Conjunto de chaves AAAA-MM-DD do ano, com cache curto em memória. */
  private async keysFor(clinicId: string, year: number): Promise<Set<string>> {
    const cacheKey = `${clinicId}:${year}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.keys;

    const rows = await this.prisma.holiday.findMany({
      where: {
        clinicId,
        date: {
          gte: new Date(Date.UTC(year, 0, 1)),
          lt: new Date(Date.UTC(year + 1, 0, 1)),
        },
      },
      select: { date: true },
    });
    const keys = new Set(rows.map((r) => r.date.toISOString().slice(0, 10)));
    this.cache.set(cacheKey, { keys, expiresAt: Date.now() + CACHE_TTL_MS });
    return keys;
  }

  private invalidate(clinicId: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${clinicId}:`)) this.cache.delete(key);
    }
  }
}

/** Exportado para o teste: AAAA-MM-DD → instante no fuso pedido. */
export { dateKeyToUtc };
