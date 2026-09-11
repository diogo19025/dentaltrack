import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api-client";
import { ErrorState } from "./error-state";

describe("ErrorState", () => {
  it("mostra a mensagem útil, o requestId e permite tentar de novo", () => {
    const retry = vi.fn();
    render(
      <ErrorState
        error={
          new ApiError(
            503,
            JSON.stringify({ message: "Serviço temporariamente indisponível" }),
            "req-123",
          )
        }
        onRetry={retry}
      />,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Serviço temporariamente indisponível");
    expect(alert).toHaveTextContent("req-123");
    fireEvent.click(screen.getByRole("button", { name: /tentar de novo/i }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
