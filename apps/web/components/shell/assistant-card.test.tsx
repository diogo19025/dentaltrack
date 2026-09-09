import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AssistantCard } from "./assistant-card";

/**
 * O cartão "Assistente ativo" aparece uma vez por login e o dono tem que
 * conseguir tirá-lo da tela — pelo X ou ao ir para Configurações — sem que
 * ele volte a cada navegação. O que estes testes protegem: as duas saídas
 * fecham o cartão, a dispensa sobrevive a uma nova montagem **do mesmo login**,
 * um login novo o traz de volta, e storage indisponível não quebra.
 */

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    onClick,
    ...rest
  }: React.PropsWithChildren<{ href: string } & React.AnchorHTMLAttributes<HTMLAnchorElement>>) => (
    <a
      href={href}
      {...rest}
      onClick={(e) => {
        onClick?.(e);
        e.preventDefault(); // jsdom não navega; evita o aviso "Not implemented: navigation".
      }}
    >
      {children}
    </a>
  ),
}));

const LOGIN_A = "sess-a";
const LOGIN_B = "sess-b";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("AssistantCard", () => {
  it("aparece por padrão com o atalho para Configurações", () => {
    render(<AssistantCard sessionId={LOGIN_A} />);
    expect(screen.getByText("Assistente ativo")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Configurar" })).toHaveAttribute("href", "/settings");
  });

  it("o X fecha o cartão e ele continua fechado numa nova montagem do mesmo login", () => {
    const { unmount } = render(<AssistantCard sessionId={LOGIN_A} />);
    fireEvent.click(screen.getByLabelText("Fechar aviso do assistente"));
    expect(screen.queryByText("Assistente ativo")).not.toBeInTheDocument();

    unmount();
    render(<AssistantCard sessionId={LOGIN_A} />);
    expect(screen.queryByText("Assistente ativo")).not.toBeInTheDocument();
  });

  it("um login novo traz o cartão de volta", () => {
    const { unmount } = render(<AssistantCard sessionId={LOGIN_A} />);
    fireEvent.click(screen.getByLabelText("Fechar aviso do assistente"));
    unmount();

    render(<AssistantCard sessionId={LOGIN_B} />);
    expect(screen.getByText("Assistente ativo")).toBeInTheDocument();
  });

  it("clicar em Configurar também fecha o cartão", () => {
    render(<AssistantCard sessionId={LOGIN_A} />);
    fireEvent.click(screen.getByRole("link", { name: "Configurar" }));
    expect(screen.queryByText("Assistente ativo")).not.toBeInTheDocument();
    expect(localStorage.getItem("dt:dismissed:assistant-card")).toBe(LOGIN_A);
  });

  it("sem sessionId a dispensa vale para o navegador inteiro", () => {
    const { unmount } = render(<AssistantCard />);
    fireEvent.click(screen.getByLabelText("Fechar aviso do assistente"));
    unmount();

    render(<AssistantCard />);
    expect(screen.queryByText("Assistente ativo")).not.toBeInTheDocument();
  });

  it("sem storage (navegação privada, bloqueio) fecha na sessão sem quebrar", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });

    render(<AssistantCard sessionId={LOGIN_A} />);
    expect(screen.getByText("Assistente ativo")).toBeInTheDocument();
    expect(() =>
      fireEvent.click(screen.getByLabelText("Fechar aviso do assistente")),
    ).not.toThrow();
  });
});
