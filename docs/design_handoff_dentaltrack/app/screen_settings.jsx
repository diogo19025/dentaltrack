/* screen_settings.jsx — Configurações do chatbot (Identidade/Persona · Ofertas/Instruções) */

function SettingsScreen() {
  const [tab, setTab] = React.useState("identidade");
  const [tone, setTone] = React.useState("amigavel");
  const [active, setActive] = React.useState(true);

  return (
    <div>
      <PageHeader title="Configurações" subtitle="Defina como o assistente de IA se comporta — sem escrever código.">
        <Button variant="secondary">Cancelar</Button>
        <Button icon={IcCheck}>Salvar alterações</Button>
      </PageHeader>

      <div style={{ marginBottom: 22 }}>
        <Segmented
          options={[{ value: "identidade", label: "Identidade & Persona" }, { value: "ofertas", label: "Ofertas & Instruções" }]}
          value={tab} onChange={setTab} />
      </div>

      <div key={tab} className="anim-fade-up" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 320px", gap: 22, alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {tab === "identidade" ? <IdentityForm tone={tone} setTone={setTone} /> : <OffersForm active={active} setActive={setActive} />}
        </div>

        {/* Preview do bot */}
        <BotPreview tab={tab} tone={tone} active={active} />
      </div>
    </div>
  );
}

function SectionCard({ title, desc, children }) {
  return (
    <Card className="card-pad">
      <div style={{ marginBottom: 20 }}>
        <div className="h-section">{title}</div>
        {desc && <div className="text-mut" style={{ fontSize: 13, marginTop: 3 }}>{desc}</div>}
      </div>
      {children}
    </Card>
  );
}

function IdentityForm({ tone, setTone }) {
  return (
    <React.Fragment>
      <SectionCard title="Identidade da clínica" desc="Como o agente se apresenta aos pacientes.">
        <div style={{ display: "flex", gap: 18, marginBottom: 18, alignItems: "center" }}>
          <div style={{ width: 76, height: 76, borderRadius: 16, border: "1.5px dashed var(--border-strong)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, color: "var(--muted-foreground)", flex: "none", cursor: "pointer", background: "var(--muted)" }}>
            <IcUpload size={18} /><span style={{ fontSize: 10.5 }}>Logo</span>
          </div>
          <div style={{ flex: 1 }}>
            <div className="field-hint" style={{ marginTop: 0, marginBottom: 8 }}>PNG ou SVG, fundo transparente. Até 1&nbsp;MB.</div>
            <Button variant="secondary" size="sm" icon={IcUpload}>Enviar logo</Button>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <Field label="Nome da clínica"><Input defaultValue="Clínica Sorriso Pleno" /></Field>
          <Field label="Especialidade">
            <Select defaultValue="geral">
              <option value="geral">Odontologia geral</option>
              <option value="estetica">Estética e harmonização</option>
              <option value="implante">Implantodontia</option>
              <option value="orto">Ortodontia</option>
            </Select>
          </Field>
        </div>
      </SectionCard>

      <SectionCard title="Persona do assistente" desc="O tom de voz e a saudação inicial da conversa.">
        <Field label="Tom de voz">
          <Segmented options={[{ value: "formal", label: "Formal" }, { value: "amigavel", label: "Amigável" }, { value: "acolhedor", label: "Acolhedor" }]} value={tone} onChange={setTone} />
        </Field>
        <div style={{ height: 18 }} />
        <Field label="Nome do assistente" hint="Aparece no topo do chat e na apresentação.">
          <Input defaultValue="Sofia" />
        </Field>
        <div style={{ height: 18 }} />
        <Field label="Mensagem de saudação" hint="Primeira mensagem que o paciente recebe.">
          <Textarea rows={3} defaultValue="Olá! Sou a assistente virtual da Clínica Sorriso Pleno. Posso tirar dúvidas sobre procedimentos, recomendar o tratamento ideal e agendar sua avaliação. Como posso te ajudar hoje?" />
        </Field>
      </SectionCard>
    </React.Fragment>
  );
}

function OffersForm({ active, setActive }) {
  return (
    <React.Fragment>
      <SectionCard title="Oferta ativa" desc="Promoção que o agente menciona quando fizer sentido na conversa.">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", background: "var(--muted)", borderRadius: "var(--radius-md)", marginBottom: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ width: 34, height: 34, borderRadius: 9, background: active ? "var(--success-tint)" : "var(--secondary)", color: active ? "var(--success)" : "var(--muted-foreground)", display: "flex", alignItems: "center", justifyContent: "center" }}><IcSparkle size={16} /></span>
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 500 }}>Oferta {active ? "ativa" : "pausada"}</div>
              <div className="text-mut" style={{ fontSize: 12 }}>O bot {active ? "pode" : "não vai"} citar esta promoção.</div>
            </div>
          </div>
          <Switch checked={active} onChange={setActive} />
        </div>
        <Field label="Texto da oferta" hint="Linguagem natural — o agente adapta ao contexto.">
          <Textarea rows={3} defaultValue="Avaliação inicial gratuita durante o mês de junho para novos pacientes." />
        </Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 18 }}>
          <Field label="Início da vigência"><Input icon={IcCalendar} defaultValue="01/06/2026" /></Field>
          <Field label="Fim da vigência"><Input icon={IcCalendar} defaultValue="30/06/2026" /></Field>
        </div>
      </SectionCard>

      <SectionCard title="Instruções específicas" desc="Regras injetadas no comportamento do agente a cada conversa.">
        <Field label="Diretrizes da clínica" hint="Ex.: 'sempre ofereça a avaliação antes de orçar', 'não passe valores fechados por mensagem'.">
          <Textarea rows={5} defaultValue={"• Sempre ofereça a avaliação gratuita antes de informar valores.\n• Para urgências e dor, priorize encaixe no mesmo dia.\n• Confirme nome e telefone antes de registrar o agendamento."} />
        </Field>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, padding: "10px 12px", background: "var(--primary-tint)", borderRadius: "var(--radius-md)", color: "var(--primary-active)", fontSize: 12.5 }}>
          <IcInfo size={15} style={{ flex: "none" }} /> Estas instruções entram no prompt do agente automaticamente.
        </div>
      </SectionCard>

      <SectionCard title="Disponibilidade" desc="Orienta o bot ao propor horários de agendamento.">
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {[["Segunda a sexta", "08:00 – 18:00", true], ["Sábado", "08:00 – 12:00", true], ["Domingo", "Fechado", false]].map(([d, h, on]) => (
            <div key={d} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
              <span style={{ fontSize: 14, fontWeight: 500 }}>{d}</span>
              <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span className="text-mut tabular" style={{ fontSize: 13 }}>{h}</span>
                <DefaultSwitch on={on} />
              </span>
            </div>
          ))}
        </div>
      </SectionCard>
    </React.Fragment>
  );
}

function DefaultSwitch({ on }) {
  const [v, setV] = React.useState(on);
  return <Switch checked={v} onChange={setV} />;
}

function BotPreview({ tone, active }) {
  const greet = "Olá! Sou a Sofia, assistente da Clínica Sorriso Pleno. Como posso ajudar com seu sorriso hoje?";
  return (
    <div style={{ position: "sticky", top: 0 }}>
      <Card style={{ overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "13px 16px", borderBottom: "1px solid var(--border)" }}>
          <span style={{ width: 34, height: 34, borderRadius: 10, background: "var(--primary-tint)", color: "var(--primary)", display: "flex", alignItems: "center", justifyContent: "center" }}><IcRobot size={18} /></span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600 }}>Preview do assistente</div>
            <div className="text-mut" style={{ fontSize: 11.5 }}>Tom: {tone}</div>
          </div>
          <span style={{ width: 8, height: 8, borderRadius: 999, background: "var(--success)" }} />
        </div>
        <div style={{ padding: "18px 16px", display: "flex", flexDirection: "column", gap: 12, background: "var(--background)", minHeight: 220 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
            <span style={{ width: 26, height: 26, borderRadius: 8, background: "var(--primary-tint)", color: "var(--primary)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}><IcRobot size={14} /></span>
            <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "14px 14px 14px 4px", padding: "10px 13px", fontSize: 13.5, lineHeight: 1.5, boxShadow: "var(--shadow-xs)" }}>{greet}</div>
          </div>
          {active && (
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
              <span style={{ width: 26, height: 26, borderRadius: 8, background: "var(--primary-tint)", color: "var(--primary)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}><IcRobot size={14} /></span>
              <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "14px 14px 14px 4px", padding: "10px 13px", fontSize: 13.5, lineHeight: 1.5, boxShadow: "var(--shadow-xs)" }}>
                Aproveite: temos <strong style={{ color: "var(--primary)" }}>avaliação gratuita em junho</strong> para novos pacientes. Quer que eu já agende a sua?
              </div>
            </div>
          )}
          <div style={{ alignSelf: "flex-end", background: "var(--primary)", color: "#fff", borderRadius: "14px 14px 4px 14px", padding: "10px 13px", fontSize: 13.5, maxWidth: "80%" }}>Quero agendar, sim!</div>
        </div>
      </Card>
      <div className="text-mut" style={{ fontSize: 12, marginTop: 12, display: "flex", gap: 7, alignItems: "center", justifyContent: "center" }}>
        <IcRefresh size={13} /> Atualiza conforme você edita
      </div>
    </div>
  );
}

Object.assign(window, { SettingsScreen });
