import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { HttpLoggingInterceptor } from './http-logging.interceptor';

/**
 * Registra o filtro de exceções e o log de request globalmente (P0.3).
 *
 * Via `APP_FILTER`/`APP_INTERCEPTOR` em vez de `app.useGlobal*` no `main.ts`
 * porque assim os dois participam da injeção de dependências — o dia em que o
 * filtro precisar do Prisma (para gravar uma falha, por exemplo) não exige
 * mudar onde ele é registrado.
 */
@Module({
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: HttpLoggingInterceptor },
  ],
})
export class ObservabilityModule {}
