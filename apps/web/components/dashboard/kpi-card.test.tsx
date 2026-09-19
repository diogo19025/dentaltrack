import { render, screen } from "@testing-library/react";
import { Users } from "lucide-react";
import { describe, expect, it, vi } from "vitest";
import { KpiCard } from "./kpi-card";

// O Sparkline (Recharts) depende de medição de layout — fora do escopo aqui.
vi.mock("@/components/charts/sparkline", () => ({
  Sparkline: ({ data }: { data: number[] }) => (
    <div data-testid="sparkline" data-points={data.length} />
  ),
}));

describe("KpiCard", () => {
  it("renderiza label, valor, hint e delta de alta (verde)", () => {
    render(
      <KpiCard
        icon={Users}
        label="Leads totais"
        value="128"
        hint="vs. janela anterior"
        kpi={{ value: 128, delta: 12, deltaDir: "up", spark: [1, 2, 3] }}
      />,
    );

    expect(screen.getByText("Leads totais")).toBeInTheDocument();
    expect(screen.getByText("128")).toBeInTheDocument();
    expect(screen.getByText("vs. janela anterior")).toBeInTheDocument();

    const badge = screen.getByText("12%");
    expect(badge.getAttribute("style")).toContain("--success-tint");
    expect(screen.getByTestId("sparkline")).toHaveAttribute("data-points", "3");
  });

  it("delta de queda usa o tom destrutivo", () => {
    render(
      <KpiCard
        icon={Users}
        label="Não completadas"
        value="37"
        kpi={{ value: 37, delta: 8, deltaDir: "down", spark: [] }}
      />,
    );

    expect(screen.getByText("8%").getAttribute("style")).toContain(
      "--destructive-tint",
    );
  });

  it("sem delta não há badge; sem spark não há sparkline", () => {
    render(
      <KpiCard
        icon={Users}
        label="Taxa de resposta"
        value="59%"
        kpi={{ value: 0.59, delta: null, deltaDir: null, spark: [] }}
      />,
    );

    expect(screen.queryByText(/%$/, { selector: "span.tabular" })).toBeNull();
    expect(screen.queryByTestId("sparkline")).toBeNull();
  });

  it("série com um único dia com valor não desenha sparkline (seria uma reta com um gancho)", () => {
    render(
      <KpiCard
        icon={Users}
        label="Leads totais"
        value="1"
        kpi={{ value: 1, delta: null, deltaDir: null, spark: [0, 0, 0, 0, 1] }}
      />,
    );

    expect(screen.queryByTestId("sparkline")).toBeNull();
  });
});
