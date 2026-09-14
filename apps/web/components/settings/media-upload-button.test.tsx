import type { MediaUploadResult } from "@dentaltrack/shared";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MediaUploadButton } from "./media-upload-button";

const state = vi.hoisted(() => ({
  mutate: vi.fn(),
  reset: vi.fn(),
  isPending: false,
  isError: false,
  error: null as Error | null,
}));

vi.mock("@/hooks/use-media-upload", () => ({
  useMediaUpload: () => ({
    mutate: state.mutate,
    reset: state.reset,
    isPending: state.isPending,
    isError: state.isError,
    error: state.error,
  }),
}));

function pick(file: File) {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("input de arquivo não encontrado");
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  fireEvent.change(input);
}

function makeFile(bytes: number, type = "image/png"): File {
  const file = new File(["x"], "logo.png", { type });
  Object.defineProperty(file, "size", { value: bytes });
  return file;
}

afterEach(() => {
  vi.clearAllMocks();
  state.isPending = false;
  state.isError = false;
  state.error = null;
});

describe("MediaUploadButton", () => {
  it("envia o arquivo escolhido e devolve a URL a quem chamou", () => {
    const onUploaded = vi.fn();
    state.mutate.mockImplementation(
      (
        _vars: unknown,
        options?: { onSuccess?: (r: MediaUploadResult) => void },
      ) => {
        options?.onSuccess?.({
          url: "https://storage/exemplo.png",
          type: "image",
          fileName: "logo.png",
          bytes: 10,
        });
      },
    );

    render(<MediaUploadButton purpose="logo" onUploaded={onUploaded} />);
    pick(makeFile(10));

    expect(state.mutate).toHaveBeenCalledTimes(1);
    expect(onUploaded).toHaveBeenCalledWith(
      expect.objectContaining({ url: "https://storage/exemplo.png" }),
    );
  });

  it("barra o arquivo grande demais **antes** de gastar a rede", () => {
    // Quem tem conexão ruim é justamente quem mais sofreria mandando 2 MB
    // para receber um 413 de volta.
    const onUploaded = vi.fn();
    render(<MediaUploadButton purpose="logo" onUploaded={onUploaded} />);

    pick(makeFile(2 * 1024 * 1024));

    expect(state.mutate).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/muito grande/i);
  });

  it("o mesmo teto não vale para a mídia da oferta", () => {
    render(<MediaUploadButton purpose="oferta" onUploaded={vi.fn()} />);

    pick(makeFile(2 * 1024 * 1024));

    expect(state.mutate).toHaveBeenCalledTimes(1);
  });

  it("mostra a mensagem que a API devolveu, não um erro genérico", () => {
    state.isError = true;
    state.error = new Error("Formato não aceito para a logo.");

    render(<MediaUploadButton purpose="logo" onUploaded={vi.fn()} />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Formato não aceito para a logo.",
    );
  });

  it("enquanto sobe, o botão avisa e não aceita outro clique", () => {
    state.isPending = true;
    render(<MediaUploadButton purpose="logo" onUploaded={vi.fn()} />);

    expect(screen.getByRole("button", { name: /enviando/i })).toBeDisabled();
  });

  it("o input de arquivo não vira um segundo controle no leitor de tela", () => {
    render(<MediaUploadButton purpose="logo" onUploaded={vi.fn()} />);

    const input = document.querySelector('input[type="file"]');
    expect(input).toHaveAttribute("aria-hidden", "true");
    expect(
      screen.getByRole("button", { name: /enviar arquivo/i }),
    ).toBeInTheDocument();
  });
});
