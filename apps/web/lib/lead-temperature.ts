import type { LeadTemperature } from "@dentaltrack/shared";

/**
 * Apresentação das faixas de temperatura (seção do dashboard + painel de
 * detalhe). Tints existentes do tema como metáfora quente→frio: rose/amber/blue.
 */
export const TEMPERATURE_META: Record<
  LeadTemperature,
  { label: string; short: string; hint: string; bg: string; fg: string }
> = {
  quente: {
    label: "Leads quentes",
    short: "Quente",
    hint: "Alta chance de conversão",
    bg: "var(--tag-rose-bg)",
    fg: "var(--tag-rose-fg)",
  },
  medio: {
    label: "Leads médios",
    short: "Médio",
    hint: "Vale acompanhar de perto",
    bg: "var(--tag-amber-bg)",
    fg: "var(--tag-amber-fg)",
  },
  fraco: {
    label: "Leads fracos",
    short: "Fraco",
    hint: "Baixo engajamento até aqui",
    bg: "var(--tag-blue-bg)",
    fg: "var(--tag-blue-fg)",
  },
};

/** Ordem de exibição (mais quente primeiro). */
export const TEMPERATURE_ORDER: readonly LeadTemperature[] = [
  "quente",
  "medio",
  "fraco",
];
