/* screen_login.jsx — Login / Signup */

function LoginScreen({ onEnter }) {
  const [mode, setMode] = React.useState("login"); // login | signup
  const [show, setShow] = React.useState(false);
  const isSignup = mode === "signup";

  return (
    <div style={{ minHeight: "100%", display: "grid", gridTemplateColumns: "minmax(0,1.05fr) minmax(0,1fr)", background: "var(--background)" }}>
      {/* Painel de marca */}
      <aside style={{ position: "relative", overflow: "hidden", background: "var(--primary)", color: "#fff", padding: "48px 56px", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
        <BrandPanelDecor />
        <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 11 }}>
          <span style={{ width: 40, height: 40, borderRadius: 11, background: "rgba(255,255,255,0.14)", display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(2px)" }}>
            <ToothMark size={24} sw={1.9} />
          </span>
          <span style={{ fontWeight: 600, fontSize: 19, letterSpacing: "-0.02em" }}>DentalTrack</span>
        </div>

        <div style={{ position: "relative", maxWidth: 420 }}>
          <div className="badge" style={{ background: "rgba(255,255,255,0.14)", color: "#eafaf6", marginBottom: 22 }}>
            <IcSparkle size={13} /> Assistente de atendimento com IA
          </div>
          <h1 style={{ fontSize: 34, lineHeight: 1.2, fontWeight: 600, letterSpacing: "-0.025em", margin: 0 }}>
            Um atendimento que nunca dorme para a sua clínica.
          </h1>
          <p style={{ fontSize: 15.5, lineHeight: 1.6, color: "rgba(255,255,255,0.82)", marginTop: 18 }}>
            Um assistente que responde seus pacientes na hora, esclarece dúvidas e já marca a consulta — a qualquer hora do dia. Você acompanha tudo num painel simples e fácil de entender.
          </p>
          <div style={{ display: "flex", gap: 26, marginTop: 34 }}>
            {[["Acompanhamento de clientes", IcLeads], ["Consultas marcadas", IcCalendar], ["Interesses dos pacientes", IcTag]].map(([t, Ic]) => (
              <div key={t} style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 13.5, color: "rgba(255,255,255,0.9)" }}>
                <Ic size={17} />{t}
              </div>
            ))}
          </div>
        </div>

        <div style={{ position: "relative", fontSize: 13, color: "rgba(255,255,255,0.7)" }}>
          © 2026 DentalTrack · Plataforma para clínicas odontológicas
        </div>
      </aside>

      {/* Painel do formulário */}
      <main style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 32px" }}>
        <div key={mode} className="anim-fade-up" style={{ width: "100%", maxWidth: 388 }}>
          <h2 className="h-title" style={{ marginBottom: 6 }}>{isSignup ? "Criar sua conta" : "Bem-vindo de volta"}</h2>
          <p className="text-mut" style={{ fontSize: 14, marginBottom: 28 }}>
            {isSignup ? "Configure o assistente da sua clínica em minutos." : "Entre para acessar o painel da sua clínica."}
          </p>

          <form onSubmit={(e) => { e.preventDefault(); onEnter(); }} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {isSignup && (
              <Field label="Nome da clínica">
                <Input icon={IcStetho} placeholder="Ex.: Clínica Sorriso Pleno" />
              </Field>
            )}
            <Field label="E-mail">
              <Input icon={IcMail} type="email" placeholder="voce@clinica.com.br" defaultValue={isSignup ? "" : ""} />
            </Field>
            <Field label="Senha">
              <div className="input-wrap">
                <IcLock />
                <input className="input" type={show ? "text" : "password"} placeholder="••••••••" style={{ paddingRight: 42 }} />
                <button type="button" onClick={() => setShow(!show)} aria-label="Mostrar senha"
                  style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: 0, cursor: "pointer", color: "var(--muted-foreground)", display: "flex", padding: 6 }}>
                  {show ? <IcEyeOff size={17} /> : <IcEye size={17} />}
                </button>
              </div>
            </Field>

            {!isSignup && (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: -2 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--muted-foreground)", cursor: "pointer" }}>
                  <input type="checkbox" style={{ accentColor: "var(--primary)", width: 15, height: 15 }} defaultChecked /> Manter conectado
                </label>
                <a href="#" onClick={(e) => e.preventDefault()} style={{ fontSize: 13, color: "var(--primary)", fontWeight: 500, textDecoration: "none" }}>Esqueci a senha</a>
              </div>
            )}

            <Button type="submit" size="lg" className="btn-block" style={{ marginTop: 4 }}>
              {isSignup ? "Criar conta" : "Entrar"} <IcChevRight size={17} />
            </Button>
          </form>

          <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "22px 0" }}>
            <div className="hr" style={{ flex: 1 }} />
            <span style={{ fontSize: 12, color: "var(--muted-foreground)" }}>ou</span>
            <div className="hr" style={{ flex: 1 }} />
          </div>

          <Button variant="secondary" size="lg" className="btn-block" onClick={onEnter}>
            <GoogleG /> Continuar com Google
          </Button>

          <p style={{ textAlign: "center", fontSize: 14, color: "var(--muted-foreground)", marginTop: 26 }}>
            {isSignup ? "Já tem conta?" : "Ainda não tem conta?"}{" "}
            <button onClick={() => setMode(isSignup ? "login" : "signup")}
              style={{ background: "none", border: 0, color: "var(--primary)", fontWeight: 600, cursor: "pointer", fontSize: 14, fontFamily: "inherit" }}>
              {isSignup ? "Entrar" : "Criar conta"}
            </button>
          </p>
        </div>
      </main>
    </div>
  );
}

function BrandPanelDecor() {
  return (
    <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.5 }} preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <radialGradient id="bg1" cx="78%" cy="14%" r="60%">
          <stop offset="0%" stopColor="#1a8f81" /><stop offset="100%" stopColor="transparent" />
        </radialGradient>
        <radialGradient id="bg2" cx="14%" cy="92%" r="55%">
          <stop offset="0%" stopColor="#0a5b53" /><stop offset="100%" stopColor="transparent" />
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

function GoogleG() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.5 12.2c0-.7-.06-1.4-.18-2.06H12v3.9h5.9a5.06 5.06 0 0 1-2.19 3.32v2.76h3.55c2.08-1.92 3.24-4.74 3.24-7.92Z"/><path fill="#34A853" d="M12 23c2.94 0 5.4-.97 7.2-2.64l-3.55-2.76c-.98.66-2.24 1.05-3.65 1.05-2.81 0-5.19-1.9-6.04-4.45H2.3v2.85A11 11 0 0 0 12 23Z"/><path fill="#FBBC05" d="M5.96 14.2a6.6 6.6 0 0 1 0-4.2V7.15H2.3a11 11 0 0 0 0 9.9l3.66-2.85Z"/><path fill="#EA4335" d="M12 5.35c1.6 0 3.02.55 4.15 1.62l3.1-3.1A11 11 0 0 0 2.3 7.15L5.96 10c.85-2.55 3.23-4.65 6.04-4.65Z"/></svg>
  );
}

Object.assign(window, { LoginScreen });
