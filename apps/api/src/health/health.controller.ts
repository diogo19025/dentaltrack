import { Controller, Get } from "@nestjs/common";
import type { HealthResponse } from "@dentaltrack/shared";
import { Public } from "../auth/public.decorator";
import { PrismaService } from "../prisma/prisma.service";

@Controller("health")
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** GET /health — público; verifica o banco (BE-0.1). */
  @Public()
  @Get()
  async check(): Promise<HealthResponse> {
    let db: HealthResponse["db"] = "up";
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      db = "down";
    }
    return {
      status: "ok",
      db,
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }
}
