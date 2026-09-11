import { fireEvent, render, screen, within } from "@testing-library/react";
import type { LeadDto } from "@dentaltrack/shared";
import { describe, expect, it, vi } from "vitest";
import { LeadTemperatureSection } from "./lead-temperature";

/** Fabrica um LeadDto completo (componente é puro por props — sem mock de hooks). */
let seq = 0;
const makeLead = (overrides: Partial<LeadDto> = {}): LeadDto => ({
  id: `00000000-0000-0000-0000-${String(++seq).padStart(12, "0")}`,
  name: "Cliente",
  phone: null,
  email: null,
  interest: null,
  tags: [],
  status: "em_andamento",
  source: "web",
  createdAt: "2026-06-10T12:00:00.000Z",
  score: 50,
  temperature: "medio",
  anonymizedAt: null,
  ...overrides,
});

describe("LeadTemperatureSection", () => {
  it("renderiza os 3 grupos com labels e contagens corretas", () => {
    render(
      <LeadTemperatureSection
        isLoading={false}
        leads={[
          makeLead({ name: "Ana", score: 80, temperature: "quente" }),
          makeLead({ name: "Bia", score: 65, temperature: "quente" }),
          makeLead({ name: "Caio", score: 40, temperature: "medio", interest: "Clareamento" }),
          makeLead({ name: "Davi", score: 10, temperature: "fraco" }),
        ]}
      />,
    );

    expect(screen.getByText("Temperatura dos leads")).toBeInTheDocument();
    expect(screen.getByText("Leads quentes")).toBeInTheDocument();
    expect(screen.getByText("Leads médios")).toBeInTheDocument();
    expect(screen.getByText("Leads fracos")).toBeInTheDocument();
    expect(screen.getByLabelText("Leads quentes: 2")).toBeInTheDocument();
    expect(screen.getByLabelText("Leads médios: 1")).toBeInTheDocument();
    expect(screen.getByLabelText("Leads fracos: 1")).toBeInTheDocument();
    expect(screen.getByText("Clareamento")).toBeInTheDocument();
  });

  it("ordena por score desc (desempate por captura recente), limita a 3 e mostra +N outros", () => {
    render(
      <LeadTemperatureSection
        isLoading={false}
        leads={[
          makeLead({ name: "Carlos", score: 70, temperature: "quente" }),
          makeLead({
            name: "Bruno Antigo",
            score: 88,
            temperature: "quente",
            createdAt: "2026-06-01T12:00:00.000Z",
          }),
          makeLead({ name: "Ana", score: 95, temperature: "quente" }),
          makeLead({
            name: "Bruno Recente",
            score: 88,
            temperature: "quente",
            createdAt: "2026-06-11T12:00:00.000Z",
          }),
        ]}
      />,
    );

    const items = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent("Ana");
    expect(items[0]).toHaveTextContent("95");
    expect(items[1]).toHaveTextContent("Bruno Recente");
    expect(items[2]).toHaveTextContent("Bruno Antigo");
    expect(screen.queryByText("Carlos")).toBeNull();
    expect(screen.getByText("+1 outro")).toBeInTheDocument();
  });

  it("bucket vazio mostra a mensagem da faixa", () => {
    render(
      <LeadTemperatureSection
        isLoading={false}
        leads={[makeLead({ name: "Ana", score: 80, temperature: "quente" })]}
      />,
    );

    // médios e fracos sem leads
    expect(screen.getAllByText("Nenhum lead nesta faixa.")).toHaveLength(2);
  });

  it("isLoading mostra skeletons (sem labels das faixas)", () => {
    const { container } = render(
      <LeadTemperatureSection isLoading leads={undefined} />,
    );

    expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(3);
    expect(screen.queryByText("Leads quentes")).toBeNull();
  });

  it("array vazio (carregado) mostra o empty state geral", () => {
    render(<LeadTemperatureSection isLoading={false} leads={[]} />);

    expect(
      screen.getByText(
        "Nenhum lead capturado ainda. Eles aparecem aqui quando o agente registra um contato.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Leads quentes")).toBeNull();
  });

  it('link "Ver todos" aponta para /leads', () => {
    render(<LeadTemperatureSection isLoading={false} leads={[]} />);

    expect(screen.getByRole("link", { name: /ver todos/i })).toHaveAttribute(
      "href",
      "/leads",
    );
  });

  it("clicar num lead chama onLeadClick com o lead (abre o painel de detalhe)", () => {
    const onLeadClick = vi.fn();
    render(
      <LeadTemperatureSection
        isLoading={false}
        onLeadClick={onLeadClick}
        leads={[
          makeLead({ name: "Ana", score: 80, temperature: "quente" }),
          makeLead({ name: "Caio", score: 40, temperature: "medio" }),
        ]}
      />,
    );

    const row = screen.getByRole("button", { name: /ana/i });
    expect(row).toHaveAttribute("aria-haspopup", "dialog");
    fireEvent.click(row);

    expect(onLeadClick).toHaveBeenCalledTimes(1);
    expect(onLeadClick).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Ana", temperature: "quente" }),
    );
  });
});
