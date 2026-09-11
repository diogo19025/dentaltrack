import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "./confirm-dialog";

describe("ConfirmDialog", () => {
  it("só executa a ação depois da confirmação explícita", () => {
    const confirm = vi.fn();
    const change = vi.fn();
    render(
      <ConfirmDialog
        open
        onOpenChange={change}
        onConfirm={confirm}
        title="Remover tag?"
        description="Esta ação altera as classificações."
        confirmLabel="Remover"
        destructive
      />,
    );

    expect(screen.getByRole("dialog")).toHaveAccessibleName("Remover tag?");
    expect(confirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Remover" }));
    expect(confirm).toHaveBeenCalledOnce();
  });

  it("cancela sem executar a ação", () => {
    const confirm = vi.fn();
    const change = vi.fn();
    render(
      <ConfirmDialog
        open
        onOpenChange={change}
        onConfirm={confirm}
        title="Trocar número?"
        description="A conexão atual será removida."
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(change).toHaveBeenCalledWith(false);
    expect(confirm).not.toHaveBeenCalled();
  });
});
