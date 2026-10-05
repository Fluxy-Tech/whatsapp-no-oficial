import { Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function AgentsPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Agentes de IA</CardTitle>
        <CardDescription>
          Em breve: configure agentes para responder automaticamente nas conversas do WhatsApp.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col items-center gap-3 rounded-md border border-dashed py-12 text-center">
          <Bot className="h-10 w-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Nenhum agente configurado ainda.</p>
          <Button disabled>Criar agente (em breve)</Button>
        </div>
      </CardContent>
    </Card>
  );
}
