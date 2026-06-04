/* screen_leads.jsx — Lista de leads capturados */

function LeadsScreen() {
  const [filter, setFilter] = React.useState("todos");

  const leads = [
    { name: "Lead", phone: "(11) 9 ····-····", proc: "Implante dentário", tags: ["implante"], status: "agendada", origin: "Web", when: "Hoje, 14:22" },
    { name: "Lead", phone: "(11) 9 ····-····", proc: "Clareamento", tags: ["clareamento"], status: "andamento", origin: "Web", when: "Hoje, 11:08" },
    { name: "Lead", phone: "(21) 9 ····-····", proc: "Avaliação ortodôntica", tags: ["ortodontia"], status: "andamento", origin: "Web", when: "Ontem, 19:40" },
    { name: "Lead", phone: "(11) 9 ····-····", proc: "Faceta de porcelana", tags: ["faceta de porcelana", "estética"], status: "agendada", origin: "Web", when: "Ontem, 16:15" },
    { name: "Lead", phone: "(31) 9 ····-····", proc: "—", tags: ["urgência"], status: "abandonada", origin: "Web", when: "2 dias atrás" },
    { name: "Lead", phone: "(11) 9 ····-····", proc: "Limpeza e profilaxia", tags: ["limpeza"], status: "agendada", origin: "Web", when: "3 dias atrás" },
    { name: "Lead", phone: "(47) 9 ····-····", proc: "Implante dentário", tags: ["implante", "avaliação"], status: "andamento", origin: "Web", when: "3 dias atrás" },
  ];

  const filtered = filter === "todos" ? leads : leads.filter((l) => l.status === filter);
  const counts = { todos: leads.length, agendada: leads.filter(l => l.status === "agendada").length, andamento: leads.filter(l => l.status === "andamento").length, abandonada: leads.filter(l => l.status === "abandonada").length };

  return (
    <div>
      <PageHeader title="Leads" subtitle="Pacientes em potencial capturados pelo agente nas conversas.">
        <Button variant="secondary" icon={IcDownload}>Exportar CSV</Button>
      </PageHeader>

      {/* Mini-resumo */}
      <div className="stagger" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 18, marginBottom: 20 }}>
        {[
          { l: "Total de leads", v: counts.todos, ic: IcLeads, c: "var(--primary)" },
          { l: "Agendados", v: counts.agendada, ic: IcCalendar, c: "var(--status-agendada)" },
          { l: "Em andamento", v: counts.andamento, ic: IcClock, c: "var(--status-andamento)" },
          { l: "Não completados", v: counts.abandonada, ic: IcInbox, c: "var(--status-abandonada)" },
        ].map((s) => (
          <Card key={s.l} hover className="card-pad" style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <span style={{ width: 42, height: 42, borderRadius: 11, background: "var(--secondary)", color: s.c, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}><s.ic size={20} /></span>
            <div>
              <div className="tabular" style={{ fontSize: 24, fontWeight: 600, lineHeight: 1 }}>{s.v}</div>
              <div className="text-mut" style={{ fontSize: 12.5, marginTop: 4 }}>{s.l}</div>
            </div>
          </Card>
        ))}
      </div>

      <Card style={{ overflow: "hidden" }}>
        {/* Toolbar */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 18px", borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 220, maxWidth: 340 }}>
            <Input icon={IcSearch} placeholder="Buscar por nome, telefone ou tag…" />
          </div>
          <div style={{ flex: 1 }} />
          <Segmented
            options={[
              { value: "todos", label: `Todos` },
              { value: "agendada", label: "Agendados" },
              { value: "andamento", label: "Em andamento" },
              { value: "abandonada", label: "Não compl." },
            ]}
            value={filter} onChange={setFilter} />
          <IconButton icon={IcFilter} variant="secondary" />
        </div>

        <div style={{ overflowX: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Lead</th><th>Contato</th><th>Interesse</th><th>Tags</th><th>Status</th><th>Origem</th><th style={{ textAlign: "right" }}>Capturado</th><th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((l, i) => (
                <tr key={i} style={{ cursor: "pointer" }}>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
                      <Avatar name="L" size={34} style={{ background: "var(--primary-tint)", color: "var(--primary)" }} />
                      <span style={{ fontWeight: 500 }}>{l.name}</span>
                    </div>
                  </td>
                  <td><span className="text-mut tabular" style={{ display: "flex", alignItems: "center", gap: 7 }}><IcPhone size={14} />{l.phone}</span></td>
                  <td className="text-mut">{l.proc}</td>
                  <td><div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{l.tags.map((t) => <Tag key={t} name={t} />)}</div></td>
                  <td><StatusBadge status={l.status} /></td>
                  <td><span className="badge badge-muted">{l.origin}</span></td>
                  <td className="text-mut tabular" style={{ textAlign: "right", whiteSpace: "nowrap" }}>{l.when}</td>
                  <td style={{ textAlign: "right" }}><IconButton icon={IcMore} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Footer / paginação */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", borderTop: "1px solid var(--border)" }}>
          <span className="text-mut" style={{ fontSize: 13 }}>Mostrando <strong style={{ color: "var(--foreground)" }}>{filtered.length}</strong> de {leads.length} leads</span>
          <div style={{ display: "flex", gap: 8 }}>
            <Button variant="secondary" size="sm" disabled style={{ opacity: .5 }}>Anterior</Button>
            <Button variant="secondary" size="sm">Próximo</Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

Object.assign(window, { LeadsScreen });
