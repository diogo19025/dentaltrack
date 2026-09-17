"use client";

import type { Bookings } from "@dentaltrack/shared";

/**
 * Rodapé do funil: quantos agendamentos o período gerou e quantos sobreviveram.
 *
 * Existe por causa de uma distorção real: a taxa de conversão conta **conversas**
 * que chegaram ao agendamento, e esse número não volta atrás quando o cliente
 * desmarca depois — a conversa converteu, o agente fez o trabalho. Desde que o
 * próprio cliente passou a cancelar pelo WhatsApp (F14), isso acontece sozinho,
 * no volume das conversas, e o dashboard sozinho passava a impressão errada.
 *
 * A correção mora aqui, na leitura, e não na máquina de status: o funil, o
 * scoring e o histórico continuam contando o que sempre contaram, e ao lado
 * deles aparece o que de fato está de pé. Note que a população é outra —
 * agendamentos, não conversas —, por isso os números não batem com o funil.
 */
export function BookingsFootnote({ bookings }: { bookings: Bookings }) {
  const n = (v: number) => v.toLocaleString("pt-BR");

  return (
    <div className="mt-[18px] border-t border-border pt-[14px]">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[13px] text-muted-foreground">
        <Stat value={n(bookings.created)} label="agendamentos registrados" />
        <Stat value={n(bookings.active)} label="ainda de pé" />
        <Stat value={n(bookings.canceled)} label="cancelados no período" />
      </div>
      <p className="mt-[6px] text-[12px] text-muted-foreground">
        A conversão conta a conversa que chegou ao agendamento e não volta atrás
        se o cliente desmarcar depois.
      </p>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <span>
      <span className="tabular font-semibold text-foreground">{value}</span>{" "}
      {label}
    </span>
  );
}
