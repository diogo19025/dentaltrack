"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TranscriptionResponse } from "@dentaltrack/shared";
import { ApiError, apiFetch } from "@/lib/api-client";

/**
 * Entrada por voz no chat (speech-to-text): grava o microfone com o
 * MediaRecorder e envia o áudio para `POST /chat/transcribe` (multipart). O
 * texto transcrito volta pelo callback `onTranscript` — a tela decide o que
 * fazer (no chat: preencher o input para o paciente revisar e enviar).
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

export type VoiceInputStatus = "idle" | "recording" | "transcribing";

export interface VoiceInput {
  status: VoiceInputStatus;
  /** Erro amigável da última tentativa (permissão, transcrição) — limpo ao regravar. */
  error: string | null;
  /** Pede o microfone e começa a gravar. */
  start: () => Promise<void>;
  /** Para a gravação e transcreve o áudio. */
  stop: () => void;
}

function friendlyError(err: unknown): string {
  if (err instanceof ApiError && err.status === 503) {
    return "A transcrição está temporariamente indisponível. Tente novamente em instantes.";
  }
  if (err instanceof ApiError && err.status === 422) {
    return "Não foi possível entender o áudio. Tente gravar novamente.";
  }
  return "Não foi possível transcrever o áudio. Tente novamente.";
}

export function useVoiceInput(onTranscript: (text: string) => void): VoiceInput {
  const [status, setStatus] = useState<VoiceInputStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<number | null>(null);
  const unmountedRef = useRef(false);

  // Callback sempre fresca sem recriar start/stop (regra do React Compiler:
  // a sincronização do ref fica num efeito, não no render).
  const onTranscriptRef = useRef(onTranscript);
  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  });

  const transcribe = useCallback(async (blob: Blob) => {
    setStatus("transcribing");
    try {
      const ext = blob.type.includes("mp4")
        ? "m4a"
        : blob.type.includes("ogg")
          ? "ogg"
          : "webm";
      const form = new FormData();
      form.append("audio", blob, `gravacao.${ext}`);
      const { text } = await apiFetch<TranscriptionResponse>("/chat/transcribe", {
        method: "POST",
        body: form,
      });
      if (unmountedRef.current) return;
      if (text) onTranscriptRef.current(text);
    } catch (err) {
      if (!unmountedRef.current) setError(friendlyError(err));
    } finally {
      if (!unmountedRef.current) setStatus("idle");
    }
  }, []);

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
      const blob = new Blob(chunks, {
        type: recorder.mimeType || mimeType || "audio/webm",
      });
      if (unmountedRef.current || blob.size === 0) {
        if (!unmountedRef.current) setStatus("idle");
        return;
      }
      void transcribe(blob);
    };

    recorder.start();
    recorderRef.current = recorder;
    setStatus("recording");
    timerRef.current = window.setTimeout(() => {
      if (recorder.state === "recording") recorder.stop();
    }, MAX_RECORDING_MS);
  }, [transcribe]);

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
