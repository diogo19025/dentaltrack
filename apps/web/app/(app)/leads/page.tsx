import { PageHeader } from "@/components/shell/page-header";
import { Card, CardContent } from "@/components/ui/card";

export default function LeadsPage() {
  return (
    <>
      <PageHeader title="Leads" subtitle="Pacientes capturados pelas conversas." />
      <Card>
        <CardContent className="py-12 text-center">
          <p className="text-sm text-muted-foreground">
            Cards-resumo e a tabela de leads (busca, filtros, paginação) chegam na{" "}
            <span className="font-medium text-foreground">Fase 3</span>.
          </p>
        </CardContent>
      </Card>
    </>
  );
}
