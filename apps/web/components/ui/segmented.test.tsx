import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Segmented } from "./segmented";

const OPTIONS = [
  { value: "7d", label: "7 dias" },
  { value: "30d", label: "30 dias" },
  { value: "50d", label: "50 dias" },
] as const;

describe("Segmented", () => {
  it("marca a opção ativa com aria-selected", () => {
    render(<Segmented options={OPTIONS} value="50d" onChange={() => {}} />);
    expect(screen.getByRole("tab", { name: "50 dias" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "7 dias" })).toHaveAttribute("aria-selected", "false");
  });

  it("clique chama onChange com o valor da opção", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Segmented options={OPTIONS} value="50d" onChange={onChange} />);

    await user.click(screen.getByRole("tab", { name: "30 dias" }));

    expect(onChange).toHaveBeenCalledWith("30d");
  });
});
