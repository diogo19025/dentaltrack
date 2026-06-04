import { PageHeader } from "@/components/shell/page-header";
import { Card, CardContent } from "@/components/ui/card";

export default function DashboardPage() {
  return (
    <>
      <PageHeader title="Dashboard" subtitle="Visão geral do atendimento da clínica." />
      <Card>
        <CardContent className="py-12 text-center">
          <p className="text-sm text-muted-foreground">
            KPIs, gráficos (linha, donut, funil, top tags) e a tabela de conversas chegam na{" "}
            <span className="font-medium text-foreground">Fase 3</span>.
          </p>
        </CardContent>
      </Card>
    </>
  );
}
