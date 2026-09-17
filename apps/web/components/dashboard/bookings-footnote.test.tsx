import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BookingsFootnote } from "./bookings-footnote";

describe("BookingsFootnote", () => {
  it("mostra registrados, de pé e cancelados no período", () => {
    render(
      <BookingsFootnote
        bookings={{ created: 1200, active: 900, canceled: 340 }}
      />,
    );

    expect(screen.getByText("1.200")).toBeInTheDocument();
    expect(screen.getByText("900")).toBeInTheDocument();
    expect(screen.getByText("340")).toBeInTheDocument();
    expect(screen.getByText(/ainda de pé/)).toBeInTheDocument();
    expect(screen.getByText(/cancelados no período/)).toBeInTheDocument();
  });

  it("explica que a conversão não volta atrás quando o cliente desmarca", () => {
    render(
      <BookingsFootnote bookings={{ created: 0, active: 0, canceled: 0 }} />,
    );

    expect(
      screen.getByText(/não volta atrás se o cliente desmarcar/i),
    ).toBeInTheDocument();
  });
});
