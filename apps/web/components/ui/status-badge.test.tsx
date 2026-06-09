import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusBadge } from "./status-badge";

describe("StatusBadge", () => {
  it.each([
    ["em_andamento", "Em andamento"],
    ["agendada", "Agendada"],
    ["abandonada", "Abandonada"],
  ] as const)("status %s exibe o rótulo '%s' e a classe de cor", (status, label) => {
    render(<StatusBadge status={status} />);
    const badge = screen.getByText(label);
    expect(badge).toHaveClass(`status-${status}`);
  });
});
