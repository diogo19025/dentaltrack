import { type ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AutomationsController } from '../automations/automations.controller';
import { IntegrationController } from '../clinicorp/integration.controller';
import { LeadsController } from '../leads/leads.controller';
import { ProceduresController } from '../procedures/procedures.controller';
import { SettingsController } from '../settings/settings.controller';
import { TagsController } from '../tags/tags.controller';
import { WhatsappConnectionController } from '../whatsapp/connection.controller';
import { RolesGuard } from './roles.guard';

type ProtectedTarget = {
  group: string;
  controller: object;
  handler: () => unknown;
};

function method(prototype: object, name: string): () => unknown {
  return Reflect.get(prototype, name) as () => unknown;
}

const protectedTargets: ProtectedTarget[] = [
  {
    group: 'integrações',
    controller: IntegrationController,
    handler: method(IntegrationController.prototype, 'status'),
  },
  {
    group: 'conexão do WhatsApp',
    controller: WhatsappConnectionController,
    handler: method(WhatsappConnectionController.prototype, 'status'),
  },
  {
    group: 'automações',
    controller: AutomationsController,
    handler: method(AutomationsController.prototype, 'get'),
  },
  {
    group: 'feriados',
    controller: AutomationsController,
    handler: method(AutomationsController.prototype, 'listHolidays'),
  },
  {
    group: 'alteração de settings',
    controller: SettingsController,
    handler: method(SettingsController.prototype, 'update'),
  },
  {
    group: 'procedimentos',
    controller: ProceduresController,
    handler: method(ProceduresController.prototype, 'create'),
  },
  {
    group: 'tags',
    controller: TagsController,
    handler: method(TagsController.prototype, 'create'),
  },
  {
    group: 'importação de leads',
    controller: LeadsController,
    handler: method(LeadsController.prototype, 'import'),
  },
];

function staffContext(target: ProtectedTarget): ExecutionContext {
  return {
    getClass: () => target.controller,
    getHandler: () => target.handler,
    switchToHttp: () => ({ getRequest: () => ({ role: 'staff' }) }),
  } as unknown as ExecutionContext;
}

describe('rotas administrativas', () => {
  const guard = new RolesGuard(new Reflector());

  it.each(protectedTargets)('$group: staff recebe 403', (target) => {
    expect(() => guard.canActivate(staffContext(target))).toThrow(
      ForbiddenException,
    );
  });
});
