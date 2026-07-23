"use client";

import { type ComponentProps, type FormEvent, type ReactNode, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  Calendar,
  ChevronRight,
  Eye,
  EyeOff,
  type LucideIcon,
  Lock,
  Mail,
  Sparkles,
  Tag,
  Users,
} from "lucide-react";
import { GoogleLogo } from "@/components/brand/google-logo";
import { BrandMark } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { brand } from "@/lib/brand";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type Mode = "login" | "signup";

/**
 * Login / Signup — réplica 1:1 de `screen_login.jsx` (F-Login).
 * Split 2 colunas: painel de marca teal (esq.) + formulário (dir.).
 * Auth real via Supabase (signIn/signUp/OAuth Google).
 */
export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");
  const [show, setShow] = useState(false);
  const [clinic, setClinic] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const isSignup = mode === "signup";

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setLoading(true);
    try {
      const supabase = createClient();
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.replace("/");
        router.refresh();
      } else {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { clinic_name: clinic } },
        });
        if (error) throw error;
        if (data.session) {
          router.replace("/");
          router.refresh();
        } else {
          setNotice("Conta criada. Verifique seu e-mail para confirmar o cadastro.");
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível autenticar.");
    } finally {
      setLoading(false);
    }
  }

  async function withGoogle() {
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/` },
    });
    if (error) setError(error.message);
  }

  function toggleMode() {
    setMode(isSignup ? "login" : "signup");
    setError(null);
    setNotice(null);
  }

  return (
    <div className="grid min-h-screen bg-background lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      {/* Painel de marca */}
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-primary px-14 py-12 text-white lg:flex">
        <BrandPanelDecor />

        <div className="relative flex items-center gap-[11px]">
          <span className="flex size-10 items-center justify-center rounded-[11px] bg-white/[0.14] backdrop-blur-[2px]">
            <BrandMark size={24} />
          </span>
          <span className="text-[19px] font-semibold tracking-[-0.02em]">{brand.name}</span>
        </div>

        <div className="relative max-w-[420px]">
          <span className="mb-[22px] inline-flex items-center gap-1.5 rounded-full bg-white/[0.14] px-2.5 py-[5px] text-xs font-medium text-[#eafaf6]">
            <Sparkles className="size-[13px]" /> Assistente de atendimento com IA
          </span>
          <h1 className="text-[34px] font-semibold leading-[1.2] tracking-[-0.025em]">
            Um atendimento que nunca dorme para a sua empresa.
          </h1>
          <p className="mt-[18px] text-[15.5px] leading-[1.6] text-white/[0.82]">
            Um assistente que responde seus clientes na hora, esclarece dúvidas e já marca o
            atendimento — a qualquer hora do dia. Você acompanha tudo num painel simples e fácil de
            entender.
          </p>
          <div className="mt-[34px] flex gap-[26px]">
            {(
              [
                ["Acompanhamento de clientes", Users],
                ["Atendimentos marcados", Calendar],
                ["Interesses dos clientes", Tag],
              ] as const
            ).map(([label, Icon]) => (
              <div key={label} className="flex items-center gap-[9px] text-[13.5px] text-white/90">
                <Icon className="size-[17px]" />
                {label}
              </div>
            ))}
          </div>
        </div>

        <div className="relative text-[13px] text-white/70">
          © 2026 {brand.name} · {brand.tagline}
        </div>
      </aside>

      {/* Painel do formulário */}
      <main className="flex items-center justify-center px-8 py-10">
        <div key={mode} className="anim-fade-up w-full max-w-[388px]">
          <h2 className="mb-1.5 text-[22px] font-semibold leading-[1.2] tracking-[-0.015em]">
            {isSignup ? "Criar sua conta" : "Bem-vindo de volta"}
          </h2>
          <p className="mb-7 text-sm text-muted-foreground">
            {isSignup
              ? "Configure o assistente da sua empresa em minutos."
              : "Entre para acessar o painel da sua empresa."}
          </p>

          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            {isSignup && (
              <Field label="Nome da empresa" htmlFor="clinic">
                <IconInput
                  id="clinic"
                  icon={Building2}
                  value={clinic}
                  onChange={(e) => setClinic(e.target.value)}
                  placeholder="Ex.: Empresa Bem-Estar"
                  required
                />
              </Field>
            )}

            <Field label="E-mail" htmlFor="email">
              <IconInput
                id="email"
                icon={Mail}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="voce@clinica.com.br"
                autoComplete="email"
                required
              />
            </Field>

            <Field label="Senha" htmlFor="password">
              <div className="relative">
                <Lock className="pointer-events-none absolute left-[13px] top-1/2 size-[17px] -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="password"
                  type={show ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete={isSignup ? "new-password" : "current-password"}
                  minLength={6}
                  required
                  className="h-[42px] bg-card pl-10 pr-11 focus-visible:border-primary focus-visible:ring-primary-tint"
                />
                <button
                  type="button"
                  onClick={() => setShow(!show)}
                  aria-label={show ? "Ocultar senha" : "Mostrar senha"}
                  className="absolute right-2 top-1/2 flex -translate-y-1/2 p-1.5 text-muted-foreground"
                >
                  {show ? <EyeOff className="size-[17px]" /> : <Eye className="size-[17px]" />}
                </button>
              </div>
            </Field>

            {!isSignup && (
              <div className="-mt-0.5 flex items-center justify-between">
                <label className="flex cursor-pointer items-center gap-2 text-[13px] text-muted-foreground">
                  <input type="checkbox" defaultChecked className="size-[15px] accent-primary" />
                  Manter conectado
                </label>
                <button type="button" className="text-[13px] font-medium text-primary">
                  Esqueci a senha
                </button>
              </div>
            )}

            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            {notice && (
              <p role="status" className="text-sm text-success">
                {notice}
              </p>
            )}

            <Button
              type="submit"
              disabled={loading}
              className="mt-1 h-[46px] w-full text-[15px]"
            >
              {loading ? "Aguarde…" : isSignup ? "Criar conta" : "Entrar"}
              <ChevronRight />
            </Button>
          </form>

          <div className="my-[22px] flex items-center gap-3">
            <span className="h-px flex-1 bg-border" />
            <span className="text-xs text-muted-foreground">ou</span>
            <span className="h-px flex-1 bg-border" />
          </div>

          <Button
            type="button"
            variant="outline"
            onClick={withGoogle}
            className="h-[46px] w-full border-border-strong bg-card text-[15px] text-secondary-foreground hover:bg-secondary"
          >
            <GoogleLogo size={17} /> Continuar com Google
          </Button>

          <p className="mt-[26px] text-center text-sm text-muted-foreground">
            {isSignup ? "Já tem conta?" : "Ainda não tem conta?"}{" "}
            <button type="button" onClick={toggleMode} className="font-semibold text-primary">
              {isSignup ? "Entrar" : "Criar conta"}
            </button>
          </p>
        </div>
      </main>
    </div>
  );
}

/** Rótulo + campo (espelha `.field-label` do design). */
function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-[7px] block text-[13px] font-medium text-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}

/** Input com ícone à esquerda (espelha `.input-wrap` do design). */
function IconInput({
  icon: Icon,
  className,
  ...props
}: ComponentProps<typeof Input> & { icon: LucideIcon }) {
  return (
    <div className="relative">
      <Icon className="pointer-events-none absolute left-[13px] top-1/2 size-[17px] -translate-y-1/2 text-muted-foreground" />
      <Input
        className={cn(
          "h-[42px] bg-card pl-10 focus-visible:border-primary focus-visible:ring-primary-tint",
          className,
        )}
        {...props}
      />
    </div>
  );
}

/** Decoração SVG sutil do painel de marca (glows + grid + círculos). */
function BrandPanelDecor() {
  return (
    <svg
      className="absolute inset-0 size-full opacity-50"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <defs>
        <radialGradient id="bg1" cx="78%" cy="14%" r="60%">
          <stop offset="0%" stopColor="#1a8f81" />
          <stop offset="100%" stopColor="transparent" />
        </radialGradient>
        <radialGradient id="bg2" cx="14%" cy="92%" r="55%">
          <stop offset="0%" stopColor="#0a5b53" />
          <stop offset="100%" stopColor="transparent" />
        </radialGradient>
        <pattern id="grid" width="34" height="34" patternUnits="userSpaceOnUse">
          <path d="M34 0H0V34" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#bg1)" />
      <rect width="100%" height="100%" fill="url(#bg2)" />
      <rect width="100%" height="100%" fill="url(#grid)" />
      <g opacity="0.10" stroke="#fff" strokeWidth="1.4" fill="none">
        <circle cx="84%" cy="76%" r="120" />
        <circle cx="84%" cy="76%" r="74" />
      </g>
    </svg>
  );
}
