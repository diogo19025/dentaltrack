/* app.jsx — App shell: sidebar, topbar, roteamento e transições */

function PageHeader({ title, subtitle, children }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, marginBottom: 24, flexWrap: "wrap" }}>
      <div>
        <h1 className="h-display">{title}</h1>
        {subtitle && <p className="text-mut" style={{ fontSize: 14.5, marginTop: 6 }}>{subtitle}</p>}
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>{children}</div>
    </div>
  );
}
window.PageHeader = PageHeader;

const NAV = [
  { id: "dashboard", label: "Dashboard", icon: IcDash },
  { id: "chat", label: "Chat", icon: IcChat },
  { id: "leads", label: "Leads", icon: IcLeads, badge: "7" },
  { id: "settings", label: "Configurações", icon: IcSettings },
];

function Sidebar({ route, setRoute, onLogout }) {
  return (
    <aside style={{ width: "var(--sidebar-w)", flex: "none", background: "var(--card)", borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ padding: "20px 20px 18px" }}><Logo mark={26} font={18} /></div>

      <div style={{ padding: "4px 12px 0" }}>
        <div className="text-mut" style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", padding: "10px 10px 8px" }}>Menu</div>
        <nav style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {NAV.map((n) => {
            const on = route === n.id;
            return (
              <button key={n.id} onClick={() => setRoute(n.id)} style={{
                display: "flex", alignItems: "center", gap: 11, width: "100%", textAlign: "left",
                fontFamily: "inherit", fontSize: 14, fontWeight: on ? 600 : 500, cursor: "pointer",
                padding: "10px 11px", borderRadius: "var(--radius-md)", border: 0,
                color: on ? "var(--primary)" : "var(--secondary-foreground)",
                background: on ? "var(--primary-tint)" : "transparent",
                transition: "background .16s ease, color .16s ease",
              }}
              onMouseEnter={(e) => { if (!on) e.currentTarget.style.background = "var(--accent)"; }}
              onMouseLeave={(e) => { if (!on) e.currentTarget.style.background = "transparent"; }}>
                <n.icon size={18} style={{ color: on ? "var(--primary)" : "var(--muted-foreground)" }} />
                <span style={{ flex: 1 }}>{n.label}</span>
                {n.badge && <span className="badge tabular" style={{ background: on ? "var(--primary)" : "var(--secondary)", color: on ? "#fff" : "var(--muted-foreground)", padding: "2px 7px", fontSize: 11 }}>{n.badge}</span>}
              </button>
            );
          })}
        </nav>
      </div>

      <div style={{ flex: 1 }} />

      {/* Cartão de plano / uso */}
      <div style={{ padding: "0 14px 12px" }}>
        <div style={{ background: "var(--primary-tint)", border: "1px solid var(--primary-tint-strong)", borderRadius: "var(--radius-lg)", padding: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <IcSparkle size={15} style={{ color: "var(--primary)" }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--primary-active)" }}>Assistente ativo</span>
          </div>
          <div style={{ fontSize: 12, color: "var(--primary-active)", opacity: .82, lineHeight: 1.45, marginBottom: 10 }}>O bot está online e respondendo pacientes no canal Web.</div>
          <button onClick={() => setRoute("settings")} style={{ width: "100%", fontFamily: "inherit", fontSize: 12.5, fontWeight: 600, color: "var(--primary)", background: "var(--card)", border: "1px solid var(--primary-tint-strong)", borderRadius: "var(--radius-sm)", padding: "8px", cursor: "pointer" }}>Configurar</button>
        </div>
      </div>

      {/* Usuário */}
      <div style={{ borderTop: "1px solid var(--border)", padding: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 8px", borderRadius: "var(--radius-md)" }}>
          <Avatar name="Dr Ana" size={36} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>Dra. Ana Martins</div>
            <div className="text-mut" style={{ fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>Sorriso Pleno</div>
          </div>
          <Tooltip label="Sair"><IconButton icon={IcLogout} onClick={onLogout} /></Tooltip>
        </div>
      </div>
    </aside>
  );
}

function Topbar({ route }) {
  const titles = { dashboard: "Dashboard", chat: "Chat", leads: "Leads", settings: "Configurações" };
  return (
    <header style={{ height: 64, flex: "none", borderBottom: "1px solid var(--border)", background: "color-mix(in srgb, var(--card) 80%, transparent)", backdropFilter: "blur(8px)", display: "flex", alignItems: "center", gap: 16, padding: "0 28px", position: "sticky", top: 0, zIndex: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, color: "var(--muted-foreground)" }}>
        <span>DentalTrack</span><IcChevRight size={14} /><span style={{ color: "var(--foreground)", fontWeight: 500 }}>{titles[route]}</span>
      </div>
      <div style={{ flex: 1 }} />
      <div style={{ width: 260 }}><Input icon={IcSearch} placeholder="Buscar conversas, leads…" /></div>
      <Tooltip label="Notificações">
        <span style={{ position: "relative" }}>
          <IconButton icon={IcBell} variant="secondary" />
          <span style={{ position: "absolute", top: 6, right: 6, width: 8, height: 8, borderRadius: 999, background: "var(--destructive)", border: "2px solid var(--card)" }} />
        </span>
      </Tooltip>
      <Tooltip label="Iniciar conversa de teste"><IconButton icon={IcPlus} variant="primary" /></Tooltip>
    </header>
  );
}

function App() {
  const [authed, setAuthed] = React.useState(false);
  const [route, setRoute] = React.useState("dashboard");

  if (!authed) return <LoginScreen onEnter={() => setAuthed(true)} />;

  const isChat = route === "chat";

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>
      <Sidebar route={route} setRoute={setRoute} onLogout={() => setAuthed(false)} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, height: "100%" }}>
        <Topbar route={route} />
        <main style={{ flex: 1, overflow: isChat ? "hidden" : "auto", minHeight: 0 }}>
          <div key={route} className="anim-fade-up" style={{ padding: isChat ? 20 : "28px 32px 40px", height: isChat ? "100%" : "auto", boxSizing: "border-box", maxWidth: isChat ? "none" : 1240, margin: isChat ? 0 : "0 auto" }}>
            {route === "dashboard" && <DashboardScreen />}
            {route === "chat" && <ChatScreen />}
            {route === "leads" && <LeadsScreen />}
            {route === "settings" && <SettingsScreen />}
          </div>
        </main>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
