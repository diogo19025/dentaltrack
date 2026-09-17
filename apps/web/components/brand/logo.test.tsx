import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Logo } from "./logo";

describe("Logo", () => {
  it("sem logoUrl mostra o monograma com as iniciais", () => {
    render(<Logo name="Clínica Moisés" />);
    expect(screen.getByText("CM")).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
  });

  it("com logoUrl mostra a imagem da empresa no lugar das iniciais", () => {
    render(<Logo name="Clínica Moisés" logoUrl="https://cdn.exemplo/logo.png" />);
    const img = document.querySelector("img");
    expect(img).toHaveAttribute("src", "https://cdn.exemplo/logo.png");
    expect(screen.queryByText("CM")).toBeNull();
    // O wordmark continua — o nome não some junto com o monograma.
    expect(screen.getByText("Clínica Moisés")).toBeInTheDocument();
  });

  it("imagem que não carrega volta para as iniciais", () => {
    render(<Logo name="Clínica Moisés" logoUrl="https://cdn.exemplo/sumiu.png" />);
    fireEvent.error(document.querySelector("img") as HTMLImageElement);
    expect(screen.getByText("CM")).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
  });
});
