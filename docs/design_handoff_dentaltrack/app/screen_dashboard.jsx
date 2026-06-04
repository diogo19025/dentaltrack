/* screen_dashboard.jsx — Dashboard de gestão */

function KpiCard({ icon: Icon, label, value, delta, deltaDir, spark, sparkColor, hint }) {
  const up = deltaDir === "up";
  return (
    <Card hover className="card-pad" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ width: 38, height: 38, borderRadius: 10, background: "var(--primary-tint)", color: "var(--primary)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Icon size={19} />
        </span>
        {delta != null && (
          <span className="badge tabular" style={{ background: up ? "var(--success-tint)" : "var(--destructive-tint)", color: up ? "var(--success)" : "var(--destructive)", fontWeight: 600 }}>
            {up ? <IcArrowUp size={13} /> : <IcArrowDn size={13} />}{delta}
          </span>
        )}
      </div>
      <div>
        <div className="text-mut" style={{ fontSize: 13, marginBottom: 5 }}>{label}</div>
        <div className="tabular" style={{ fontSize: 30, fontWeight: 600, letterSpacing: "-0.02em", lineHeight: 1 }}>{value}</div>
        {hint && <div className="text-mut" style={{ fontSize: 12, marginTop: 7 }}>{hint}</div>}
      </div>
      {spark && <div style={{ marginTop: -2 }}><Sparkline data={spark} w={210} h={34} color={sparkColor || "var(--primary)"} /></div>}
    </Card>
  );
}

function DashboardScreen() {
  const [range, setRange] = React.useState("50d");

  const kpis = [
    { icon: IcLeads, label: "Leads totais", value: "148", delta: "12%", deltaDir: "up", spark: [4,6,5,8,7,9,8,11,10,13], hint: "Pessoas capturadas no período" },
    { icon: IcMsg, label: "Mensagens do bot (50d)", value: "2.314", delta: "18%", deltaDir: "up", spark: [10,12,11,15,14,16,18,17,20,22], hint: "Respostas do agente · janela 50 dias" },
    { icon: IcRefresh, label: "Taxa de resposta", value: "82%", delta: "5%", deltaDir: "up", spark: [6,7,6,8,9,8,10,11,10,12], hint: "Pacientes que responderam o bot" },
    { icon: IcTarget, label: "Taxa de conversão", value: "28%", delta: "3%", deltaDir: "down", spark: [9,8,9,7,8,7,9,8,7,8], hint: "Da 1ª msg até o agendamento" },
    { icon: IcClock, label: "Em andamento", value: "9", delta: null, hint: "Conversas abertas sem conversão" },
    { icon: IcInbox, label: "Não completadas", value: "7", delta: null, hint: "Iniciadas e abandonadas" },
  ];

  const lineLabels = Array.from({ length: 14 }, (_, i) => `${i * 4 + 2}`);
  const lineSeries = [
    { name: "Bot", color: "var(--chart-1)", data: [12,16,14,20,18,24,22,26,25,30,28,33,31,36] },
    { name: "Paciente", color: "var(--chart-3)", data: [8,10,9,13,12,15,14,17,16,20,18,21,20,24] },
  ];
  const funnel = [
    { label: "Conversas iniciadas", value: 100 },
    { label: "Conversas engajadas", value: 64 },
    { label: "Agendamentos", value: 28 },
  ];
  const topTags = [
    { label: "implante", value: 42, color: "var(--tag-teal-fg)" },
    { label: "clareamento", value: 31, color: "var(--tag-amber-fg)" },
    { label: "ortodontia", value: 24, color: "var(--tag-blue-fg)" },
    { label: "faceta", value: 18, color: "var(--tag-violet-fg)" },
    { label: "urgência", value: 11, color: "var(--tag-rose-fg)" },
  ];
  const donut = [
    { label: "Em andamento", value: 9, color: "var(--status-andamento)" },
    { label: "Agendada", value: 14, color: "var(--status-agendada)" },
    { label: "Abandonada", value: 7, color: "var(--status-abandonada)" },
  ];
  const recent = [
    { name: "Paciente", proc: "Implante dentário", tags: ["implante"], status: "agendada", when: "há 12 min" },
    { name: "Paciente", proc: "Clareamento", tags: ["clareamento"], status: "andamento", when: "há 38 min" },
    { name: "Paciente", proc: "Avaliação ortodôntica", tags: ["ortodontia"], status: "andamento", when: "há 1 h" },
    { name: "Paciente", proc: "Faceta de porcelana", tags: ["faceta de porcelana", "estética"], status: "agendada", when: "há 2 h" },
    { name: "Paciente", proc: "—", tags: ["urgência"], status: "abandonada", when: "ontem" },
  ];

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="Visão geral do atendimento e da conversão da sua clínica.">
        <Segmented options={[{ value: "7d", label: "7 dias" }, { value: "30d", label: "30 dias" }, { value: "50d", label: "50 dias" }, { value: "90d", label: "90 dias" }]} value={range} onChange={setRange} />
        <Button variant="secondary" icon={IcDownload}>Exportar</Button>
      </PageHeader>

      {/* KPIs */}
      <div className="stagger" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 18, marginBottom: 18 }}>
        {kpis.map((k) => <KpiCard key={k.label} {...k} />)}
      </div>

      {/* Linha + Donut */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.7fr) minmax(0,1fr)", gap: 18, marginBottom: 18 }}>
        <Card className="card-pad anim-fade-up">
          <div className="card-head" style={{ marginBottom: 18 }}>
            <div>
              <div className="h-section">Volume de mensagens</div>
              <div className="text-mut" style={{ fontSize: 13, marginTop: 3 }}>Bot × paciente por dia · últimos 50 dias</div>
            </div>
            <ChartLegend items={[{ c: "var(--chart-1)", l: "Bot" }, { c: "var(--chart-3)", l: "Paciente" }]} />
          </div>
          <LineChart series={lineSeries} labels={lineLabels} height={250} />
        </Card>

        <Card className="card-pad anim-fade-up">
          <div className="h-section" style={{ marginBottom: 4 }}>Status das conversas</div>
          <div className="text-mut" style={{ fontSize: 13, marginBottom: 22 }}>Distribuição atual</div>
          <div style={{ display: "flex", justifyContent: "center" }}><Donut data={donut} /></div>
        </Card>
      </div>

      {/* Funil + Top tags */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 18, marginBottom: 18 }}>
        <Card className="card-pad anim-fade-up">
          <div className="h-section" style={{ marginBottom: 4 }}>Funil de conversão</div>
          <div className="text-mut" style={{ fontSize: 13, marginBottom: 22 }}>Iniciadas → engajadas → agendadas</div>
          <Funnel stages={funnel} />
        </Card>
        <Card className="card-pad anim-fade-up">
          <div className="h-section" style={{ marginBottom: 4 }}>Tags mais frequentes</div>
          <div className="text-mut" style={{ fontSize: 13, marginBottom: 22 }}>Interesses detectados nas conversas</div>
          <HBars data={topTags} />
        </Card>
      </div>

      {/* Tabela conversas recentes */}
      <Card className="anim-fade-up" style={{ overflow: "hidden" }}>
        <div className="card-pad card-head" style={{ paddingBottom: 16 }}>
          <div>
            <div className="h-section">Conversas recentes</div>
            <div className="text-mut" style={{ fontSize: 13, marginTop: 3 }}>Últimas interações do agente</div>
          </div>
          <Button variant="ghost" size="sm" iconRight={IcChevRight}>Ver todas</Button>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="table">
            <thead><tr><th>Paciente</th><th>Procedimento</th><th>Tags</th><th>Status</th><th style={{ textAlign: "right" }}>Atualizada</th></tr></thead>
            <tbody>
              {recent.map((r, i) => (
                <tr key={i} style={{ cursor: "pointer" }}>
                  <td><div style={{ display: "flex", alignItems: "center", gap: 10 }}><Avatar name="P" size={32} style={{ background: "var(--secondary)", color: "var(--muted-foreground)" }} /><span style={{ fontWeight: 500 }}>{r.name}</span></div></td>
                  <td className="text-mut">{r.proc}</td>
                  <td><div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{r.tags.map((t) => <Tag key={t} name={t} />)}</div></td>
                  <td><StatusBadge status={r.status} /></td>
                  <td className="text-mut tabular" style={{ textAlign: "right" }}>{r.when}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function ChartLegend({ items }) {
  return (
    <div style={{ display: "flex", gap: 16 }}>
      {items.map((it) => (
        <span key={it.l} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, color: "var(--muted-foreground)" }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: it.c }} />{it.l}
        </span>
      ))}
    </div>
  );
}

Object.assign(window, { DashboardScreen });
