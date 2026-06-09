import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Tag } from "./tag";

describe("Tag", () => {
  it("usa a cor explícita do banco quando fornecida", () => {
    render(<Tag name="implante" color="rose" />);
    expect(screen.getByText("implante")).toHaveClass("tag", "tag-rose");
  });

  it("deriva a cor do nome quando não há cor explícita", () => {
    render(<Tag name="clareamento" />);
    expect(screen.getByText("clareamento")).toHaveClass("tag-amber");
  });

  it("nome desconhecido cai no teal padrão", () => {
    render(<Tag name="qualquer-coisa" />);
    expect(screen.getByText("qualquer-coisa")).toHaveClass("tag-teal");
  });

  it("renderiza o ponto por padrão e o omite com dot=false", () => {
    const { container, rerender } = render(<Tag name="implante" />);
    expect(container.querySelector(".tag-d")).not.toBeNull();
    rerender(<Tag name="implante" dot={false} />);
    expect(container.querySelector(".tag-d")).toBeNull();
  });
});
