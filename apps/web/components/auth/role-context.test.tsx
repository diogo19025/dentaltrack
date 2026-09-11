import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OwnerOnly, RoleProvider, useRole } from "./role-context";

function RoleLabel() {
  const { role, roleKnown } = useRole();
  return <span>{roleKnown ? role : "desconhecido"}</span>;
}

describe("RoleProvider", () => {
  it("mostra controles administrativos ao owner", () => {
    render(
      <RoleProvider role="owner">
        <RoleLabel />
        <OwnerOnly>Configurações</OwnerOnly>
      </RoleProvider>,
    );
    expect(screen.getByText("owner")).toBeInTheDocument();
    expect(screen.getByText("Configurações")).toBeInTheDocument();
  });

  it("esconde controles administrativos do staff", () => {
    render(
      <RoleProvider role="staff">
        <RoleLabel />
        <OwnerOnly>Configurações</OwnerOnly>
      </RoleProvider>,
    );
    expect(screen.getByText("staff")).toBeInTheDocument();
    expect(screen.queryByText("Configurações")).not.toBeInTheDocument();
  });

  it("é fail-closed sem provider", () => {
    render(<OwnerOnly>Configurações</OwnerOnly>);
    expect(screen.queryByText("Configurações")).not.toBeInTheDocument();
  });

  // A regressão de 2026-09-11: a API não devolveu o papel (estava numa versão
  // anterior ao PR 8) e o dono ficou sem acesso às Configurações, com a tela
  // afirmando que ele não era o proprietário.
  it("não rebaixa o usuário quando o papel é desconhecido", () => {
    render(
      <RoleProvider role={null}>
        <RoleLabel />
        <OwnerOnly>Configurações</OwnerOnly>
      </RoleProvider>,
    );
    expect(screen.getByText("desconhecido")).toBeInTheDocument();
    expect(screen.getByText("Configurações")).toBeInTheDocument();
  });
});
