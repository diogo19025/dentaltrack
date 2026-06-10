"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Entrada por voz no chat: grava o microfone com o MediaRecorder e entrega o
 * áudio pronto (data URL base64 + MIME) pelo callback `onAudio`. A tela envia
 * o áudio como a própria mensagem do turno (`POST /chat` com `audio`/`audioType`)
 * — a transcrição acontece no servidor e o bot responde em texto.
 */

/** Auto-stop da gravação — protege o free tier e o tamanho do upload. */
const MAX_RECORDING_MS = 60_000;

/** Formatos do MediaRecorder por ordem de preferência (Chrome/Edge → Safari → Firefox). */
const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
];

export interface RecordedAudio {
  /** Áudio como data URL (`data:audio/...;base64,...`) — pronto para tocar e enviar. */
  dataUrl: string;
  /** MIME normalizado (sem `;codecs=...`), ex.: `audio/webm`. */
  mediaType: string;
}

export type VoiceInputStatus = "idle" | "recording";

export interface VoiceInput {
  status: VoiceInputStatus;
  /** Erro amigável da última tentativa (permissão/suporte) — limpo ao regravar. */
  error: string | null;
  /** Pede o microfone e começa a gravar. */
  start: () => Promise<void>;
  /** Para a gravação e dispara `onAudio` com o áudio gravado. */
  stop: () => void;
}

/** Blob → data URL (base64). */
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("Falha ao ler o áudio."));
    reader.readAsDataURL(blob);
  });
}

export function useVoiceInput(onAudio: (audio: RecordedAudio) => void): VoiceInput {
  const [status, setStatus] = useState<VoiceInputStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<number | null>(null);
  const unmountedRef = useRef(false);

  // Callback sempre fresca sem recriar start/stop (regra do React Compiler:
  // a sincronização do ref fica num efeito, não no render).
  const onAudioRef = useRef(onAudio);
  useEffect(() => {
    onAudioRef.current = onAudio;
  });

  const start = useCallback(async () => {
    if (recorderRef.current) return;
    setError(null);

    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError("Gravação de áudio não é suportada neste navegador.");
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError("Permita o acesso ao microfone para enviar áudio.");
      return;
    }

    const mimeType = MIME_CANDIDATES.find((t) => MediaRecorder.isTypeSupported(t));
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      recorderRef.current = null;
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (!unmountedRef.current) setStatus("idle");

      const type = recorder.mimeType || mimeType || "audio/webm";
      const blob = new Blob(chunks, { type });
      if (unmountedRef.current || blob.size === 0) return;

      void blobToDataUrl(blob)
        .then((dataUrl) => {
          if (unmountedRef.current) return;
          onAudioRef.current({ dataUrl, mediaType: type.split(";")[0].trim() });
        })
        .catch(() => {
          if (!unmountedRef.current) {
            setError("Não foi possível processar o áudio. Tente novamente.");
          }
        });
    };

    recorder.start();
    recorderRef.current = recorder;
    setStatus("recording");
    timerRef.current = window.setTimeout(() => {
      if (recorder.state === "recording") recorder.stop();
    }, MAX_RECORDING_MS);
  }, []);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state === "recording") recorder.stop();
  }, []);

  // Desmontou no meio da gravação: para o recorder e libera o microfone.
  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      recorderRef.current?.stream.getTracks().forEach((t) => t.stop());
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  return { status, error, start, stop };
}
