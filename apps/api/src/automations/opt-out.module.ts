import { Module } from '@nestjs/common';
import { OptOutService } from './opt-out.service';

/**
 * Descadastro de mensagens automáticas (F9), num módulo próprio de propósito.
 *
 * Dois lados precisam dele: o **adapter do WhatsApp**, que reconhece o pedido
 * quando o cliente escreve "parar", e a **fila de saída**, que precisa obedecê-
 * lo. Como o módulo de automações já depende do WhatsApp (para o transporte),
 * deixar o descadastro lá dentro criaria uma dependência circular. Isolá-lo
 * aqui resolve isso e deixa a regra num lugar só.
 */
@Module({
  providers: [OptOutService],
  exports: [OptOutService],
})
export class OptOutModule {}
