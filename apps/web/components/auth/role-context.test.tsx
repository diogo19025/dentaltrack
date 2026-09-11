import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OwnerOnly, RoleProvider, useRole } from "./role-context";

function RoleLabel() {
  const { role } = useRole();
  return <span>{role}</span>;
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
});
