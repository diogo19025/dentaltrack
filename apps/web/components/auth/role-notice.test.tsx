import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RoleProvider } from "./role-context";
import { RoleNotice } from "./role-notice";

const state = { refresh: vi.fn() };

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: state.refresh }),
}));

const AVISO = /não foi possível confirmar suas permissões/i;

describe("RoleNotice", () => {
  beforeEach(() => {
    state.refresh = vi.fn();
  });

  it("fica calado quando o papel é conhecido", () => {
    render(
      <RoleProvider role="staff">
        <RoleNotice />
      </RoleProvider>,
    );
    expect(screen.queryByText(AVISO)).not.toBeInTheDocument();
  });

  it("avisa quando o papel não pôde ser confirmado", () => {
    render(
      <RoleProvider role={null}>
        <RoleNotice />
      </RoleProvider>,
    );
    expect(screen.getByText(AVISO)).toBeInTheDocument();
  });

  it("oferece nova tentativa sem exigir F5", async () => {
    render(
      <RoleProvider role={null}>
        <RoleNotice />
      </RoleProvider>,
    );
    await userEvent.click(
      screen.getByRole("button", { name: /tentar novamente/i }),
    );
    expect(state.refresh).toHaveBeenCalledTimes(1);
  });
});
