import { render, screen } from "@testing-library/react";
import type { OnboardingChecklistDto } from "@dentaltrack/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OnboardingChecklist } from "./onboarding-checklist";

const state = vi.hoisted(() => ({
  data: undefined as OnboardingChecklistDto | undefined,
  isLoading: false,
  isError: false,
}));

vi.mock("@/hooks/use-onboarding-checklist", () => ({
  useOnboardingChecklist: () => ({
    data: state.data,
    isLoading: state.isLoading,
    isError: state.isError,
  }),
}));

function makeDto(over: Partial<OnboardingChecklistDto> = {}): OnboardingChecklistDto {
  const items: OnboardingChecklistDto["items"] = [
    {
      key: "identidade",
      label: "Apresentar a empresa e o assistente",
      description: "Especialidade, nome e saudação.",
      done: true,
      href: "/settings?tab=identidade",
    },
    {
      key: "whatsapp",
      label: "Conectar o WhatsApp",
      description: "Parear o número dedicado pelo QR code.",
      done: false,
      href: "/settings?tab=whatsapp",
    },
  ];
  return { items, done: 1, total: 2, complete: false, ...over };
}

afterEach(() => {
  state.data = undefined;
  state.isLoading = false;
  state.isError = false;
});

describe("OnboardingChecklist", () => {
  it("lista os passos com o progresso e aponta cada pendência para a sua aba", () => {
    state.data = makeDto();
    render(<OnboardingChecklist />);

    expect(screen.getByText("Primeiros passos")).toBeInTheDocument();
    expect(screen.getByText("1 de 2")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");

    const pending = screen.getByRole("link", { name: "Conectar o WhatsApp" });
    expect(pending).toHaveAttribute("href", "/settings?tab=whatsapp");
    expect(screen.getByText("Parear o número dedicado pelo QR code.")).toBeInTheDocument();

    // O feito continua clicável, mas sem a instrução — já foi resolvido.
    const done = screen.getByRole("link", {
      name: "Apresentar a empresa e o assistente (feito)",
    });
    expect(done).toHaveAttribute("href", "/settings?tab=identidade");
    expect(screen.queryByText("Especialidade, nome e saudação.")).not.toBeInTheDocument();
  });

  it("some quando tudo está feito", () => {
    state.data = makeDto({ done: 2, total: 2, complete: true });
    const { container } = render(<OnboardingChecklist />);
    expect(container).toBeEmptyDOMElement();
  });

  it("some em erro — é ajuda, não alarme", () => {
    state.isError = true;
    const { container } = render(<OnboardingChecklist />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
