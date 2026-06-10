import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HBars } from "./h-bars";

describe("HBars", () => {
  it("escala as barras pelo maior valor e usa a cor da tag", () => {
    const { container } = render(
      <HBars
        data={[
          { name: "implante", color: "teal", value: 30 },
          { name: "limpeza", color: "sage", value: 15 },
        ]}
      />,
    );

    expect(screen.getByText("implante")).toBeInTheDocument();
    expect(screen.getByText("limpeza")).toBeInTheDocument();
    expect(screen.getByText("30")).toBeInTheDocument();
    expect(screen.getByText("15")).toBeInTheDocument();

    const bars = container.querySelectorAll<HTMLElement>(".bar-grow");
    expect(bars[0].style.width).toBe("100%");
    expect(bars[1].style.width).toBe("50%");
    expect(bars[0].getAttribute("style")).toContain("--tag-teal-fg");
    expect(bars[1].getAttribute("style")).toContain("--tag-sage-fg");
  });

  it("lista vazia renderiza sem barras (sem crash)", () => {
    const { container } = render(<HBars data={[]} />);
    expect(container.querySelectorAll(".bar-grow")).toHaveLength(0);
  });
});
