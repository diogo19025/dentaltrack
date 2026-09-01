import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import type {
  NotificationsDto,
  NotificationsSeenResult,
} from '@dentaltrack/shared';
import { ClinicId } from '../auth/clinic-id.decorator';
import { TenantGuard } from '../auth/tenant.guard';
import { NotificationsService } from './notifications.service';

/**
 * Sino do topbar (F11). Protegido: SupabaseJwtGuard (global) + TenantGuard.
 * `GET /notifications` → itens recentes + contador; `POST /notifications/seen`
 * → marca tudo como visto (abrir o painel zera o badge).
 */
@Controller('notifications')
@UseGuards(TenantGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@ClinicId() clinicId: string): Promise<NotificationsDto> {
    return this.notifications.getNotifications(clinicId);
  }

  @Post('seen')
  markSeen(@ClinicId() clinicId: string): Promise<NotificationsSeenResult> {
    return this.notifications.markSeen(clinicId);
  }
}
