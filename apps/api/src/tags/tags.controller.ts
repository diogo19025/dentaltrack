import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from "@nestjs/common";
import type { TagDto } from "@dentaltrack/shared";
import { ClinicId } from "../auth/clinic-id.decorator";
import { TenantGuard } from "../auth/tenant.guard";
import { CreateTagDto, UpdateTagDto } from "./dto";
import { TagsService } from "./tags.service";

/**
 * CRUD das tags de interesse (BE-2.3). Protegido: SupabaseJwtGuard (global) +
 * TenantGuard resolve o `clinicId`. Toda operação é escopada por clínica.
 */
@Controller("tags")
@UseGuards(TenantGuard)
export class TagsController {
  constructor(private readonly tags: TagsService) {}

  @Get()
  list(@ClinicId() clinicId: string): Promise<TagDto[]> {
    return this.tags.list(clinicId);
  }

  @Post()
  create(@ClinicId() clinicId: string, @Body() body: CreateTagDto): Promise<TagDto> {
    return this.tags.create(clinicId, body);
  }

  @Patch(":id")
  update(
    @ClinicId() clinicId: string,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: UpdateTagDto,
  ): Promise<TagDto> {
    return this.tags.update(clinicId, id, body);
  }

  @Delete(":id")
  remove(
    @ClinicId() clinicId: string,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<{ id: string }> {
    return this.tags.remove(clinicId, id);
  }
}
