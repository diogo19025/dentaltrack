import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Funnel } from "./funnel";

describe("Funnel", () => {
  it("renderiza os 3 estágios com % relativo ao topo", () => {
    const { container } = render(<Funnel data={{ started: 90, engaged: 53, scheduled: 21 }} />);

    expect(screen.getByText("Conversas iniciadas")).toBeInTheDocument();
    expect(screen.getByText("Conversas engajadas")).toBeInTheDocument();
    expect(screen.getByText("Agendamentos")).toBeInTheDocument();

    // 53/90 → 59% · 21/90 → 23%
    expect(screen.getByText("· 100%")).toBeInTheDocument();
    expect(screen.getByText("· 59%")).toBeInTheDocument();
    expect(screen.getByText("· 23%")).toBeInTheDocument();

    const bars = container.querySelectorAll<HTMLElement>(".bar-grow");
    expect(Array.from(bars).map((b) => b.style.width)).toEqual(["100%", "59%", "23%"]);
  });

  it("não quebra com funil zerado (divisor vira 1)", () => {
    const { container } = render(<Funnel data={{ started: 0, engaged: 0, scheduled: 0 }} />);
    const bars = container.querySelectorAll<HTMLElement>(".bar-grow");
    expect(Array.from(bars).map((b) => b.style.width)).toEqual(["0%", "0%", "0%"]);
  });
});
