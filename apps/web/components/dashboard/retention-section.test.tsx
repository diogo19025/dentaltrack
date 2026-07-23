import { render, screen } from "@testing-library/react";
import type { Retention } from "@dentaltrack/shared";
import { describe, expect, it, vi } from "vitest";
import { RetentionSection } from "./retention-section";

// Recharts não renderiza no jsdom (ResponsiveContainer sem dimensões) — o
// gráfico é substituído por um marcador; a seção (números/estados) é o alvo.
vi.mock("@/components/charts/retention-line", () => ({
  RetentionLine: ({ data }: { data: Retention }) => (
    <div data-testid="retention-line" data-points={data.labels.length} />
  ),
}));

function makeRetention(over: Partial<Retention> = {}): Retention {
  return {
    labels: ["01/06", "02/06", "03/06"],
    abandoned: [1, 0, 2],
    recurrent: [0, 1, 0],
    abandonedTotal: 3,
    recurrentLeads: 1,
    recurrenceRate: 0.25,
    ...over,
  };
}

describe("RetentionSection", () => {
  it("mostra os totais do período e a taxa de recorrência", () => {
    render(<RetentionSection retention={makeRetention()} rangeDaysLabel="30" />);

    expect(screen.getByText("Abandono × Recorrência")).toBeInTheDocument();
    expect(screen.getByText("Clientes recorrentes")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("Atendimentos abandonados")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("Taxa de recorrência")).toBeInTheDocument();
    expect(screen.getByText("25%")).toBeInTheDocument();
    // Subtítulo reflete o período selecionado.
    expect(screen.getByText(/últimos 30\s+dias/)).toBeInTheDocument();
  });

  it("renderiza o gráfico quando há dados", () => {
    render(<RetentionSection retention={makeRetention()} rangeDaysLabel="7" />);
    expect(screen.getByTestId("retention-line")).toHaveAttribute("data-points", "3");
  });

  it("sem dados: mostra o estado vazio no lugar do gráfico", () => {
    render(
      <RetentionSection
        retention={makeRetention({
          abandoned: [0, 0, 0],
          recurrent: [0, 0, 0],
          abandonedTotal: 0,
          recurrentLeads: 0,
          recurrenceRate: 0,
        })}
        rangeDaysLabel="7"
      />,
    );
    expect(screen.queryByTestId("retention-line")).not.toBeInTheDocument();
    expect(screen.getByText(/Sem abandonos nem retornos no período/)).toBeInTheDocument();
  });
});
