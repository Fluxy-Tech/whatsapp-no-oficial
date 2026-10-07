import type { StageOption } from "@/components/agents/MetadadosEditor";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OptionsSelect } from "@/components/ui/options-select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

export type KanbanDraft = {
  leadOnFirstMessage: boolean;
  leadStageId: string;
  completedStageId: string;
};

type KanbanAutomationCardProps = {
  value: KanbanDraft;
  onChange: (value: KanbanDraft) => void;
  stageOptions: StageOption[];
  /** null = loaded; string = why the pipelines couldn't be loaded. */
  stagesError: string | null;
  disabled: boolean;
};

function StageSelect({
  id,
  value,
  onChange,
  options,
  disabled,
  empty,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  options: StageOption[];
  disabled: boolean;
  empty: string;
}) {
  return (
    <OptionsSelect
      id={id}
      value={value}
      onValueChange={onChange}
      disabled={disabled}
      options={[{ value: "", label: empty }, ...options.map((stage) => ({ value: stage.id, label: stage.label }))]}
    />
  );
}

export function KanbanAutomationCard({ value, onChange, stageOptions, stagesError, disabled }: KanbanAutomationCardProps) {
  const noStages = !stageOptions.length;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Quadro</CardTitle>
        <CardDescription>
          Coloque os leads no quadro automaticamente. Para mover o lead quando um dado específico for coletado, escolha a
          coluna em cada metadado acima.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {stagesError ? (
          <p className="text-sm text-destructive">{stagesError}</p>
        ) : (
          noStages && (
            <p className="text-sm text-muted-foreground">
              Nenhuma esteira criada ainda. Crie esteiras e colunas em CRM › Quadro.
            </p>
          )
        )}

        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm font-medium">
            <Switch
              checked={value.leadOnFirstMessage}
              onCheckedChange={(leadOnFirstMessage) => onChange({ ...value, leadOnFirstMessage })}
              disabled={disabled || noStages}
              aria-label="Criar lead na primeira mensagem"
            />
            Criar o lead no quadro assim que o contato mandar mensagem
          </label>
          {value.leadOnFirstMessage && (
            <StageSelect
              id="agent-lead-stage"
              value={value.leadStageId}
              onChange={(leadStageId) => onChange({ ...value, leadStageId })}
              options={stageOptions}
              disabled={disabled}
              empty="Escolha a esteira e a coluna"
            />
          )}
          <p className="text-xs text-muted-foreground">
            Desligado, o lead só entra no quadro quando um metadado ou a coleta completa movê-lo para alguma coluna.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="agent-completed-stage">Ao coletar todos os metadados, mover para</Label>
          <StageSelect
            id="agent-completed-stage"
            value={value.completedStageId}
            onChange={(completedStageId) => onChange({ ...value, completedStageId })}
            options={stageOptions}
            disabled={disabled || noStages}
            empty="Não mover"
          />
        </div>
      </CardContent>
    </Card>
  );
}

export type SchedulingDraft = {
  enabled: boolean;
  meetingDurationMinutes: string;
  startTime: string;
  endTime: string;
  weekdays: number[];
  maxEventsPerDay: string;
  maxEventsPerSlot: string;
};

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

type SchedulingCardProps = {
  value: SchedulingDraft;
  onChange: (value: SchedulingDraft) => void;
  disabled: boolean;
};

export function SchedulingCard({ value, onChange, disabled }: SchedulingCardProps) {
  const fieldsDisabled = disabled || !value.enabled;

  function toggleWeekday(day: number) {
    const weekdays = value.weekdays.includes(day)
      ? value.weekdays.filter((d) => d !== day)
      : [...value.weekdays, day].sort();
    onChange({ ...value, weekdays });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Agendamento de reuniões</CardTitle>
        <CardDescription>
          O agente pede data e hora ao contato, confere os horários livres e agenda a reunião no calendário com um
          atendente disponível. Quem recebe reuniões é definido em Configurações › Membros.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <label className="flex items-center gap-2 text-sm font-medium">
          <Switch
            checked={value.enabled}
            onCheckedChange={(enabled) => onChange({ ...value, enabled })}
            disabled={disabled}
            aria-label="Agendamento ativo"
          />
          {value.enabled ? "Agendamento ativado" : "Agendamento desativado"}
        </label>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="scheduling-duration">Duração (minutos)</Label>
            <Input
              id="scheduling-duration"
              type="number"
              min={5}
              max={600}
              step={5}
              value={value.meetingDurationMinutes}
              onChange={(e) => onChange({ ...value, meetingDurationMinutes: e.target.value })}
              disabled={fieldsDisabled}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="scheduling-start">Início do atendimento</Label>
            <Input
              id="scheduling-start"
              type="time"
              value={value.startTime}
              onChange={(e) => onChange({ ...value, startTime: e.target.value })}
              disabled={fieldsDisabled}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="scheduling-end">Fim do atendimento</Label>
            <Input
              id="scheduling-end"
              type="time"
              value={value.endTime}
              onChange={(e) => onChange({ ...value, endTime: e.target.value })}
              disabled={fieldsDisabled}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label>Dias de atendimento</Label>
          <div className="flex flex-wrap gap-2">
            {WEEKDAYS.map((label, day) => {
              const selected = value.weekdays.includes(day);
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => toggleWeekday(day)}
                  disabled={fieldsDisabled}
                  aria-pressed={selected}
                  className={cn(
                    "h-9 w-12 rounded-md border text-sm font-medium transition-colors disabled:opacity-50",
                    selected ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent",
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="scheduling-max-day">Limite de reuniões por dia</Label>
            <Input
              id="scheduling-max-day"
              type="number"
              min={1}
              value={value.maxEventsPerDay}
              onChange={(e) => onChange({ ...value, maxEventsPerDay: e.target.value })}
              placeholder="Sem limite"
              disabled={fieldsDisabled}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="scheduling-max-slot">Limite de reuniões no mesmo horário</Label>
            <Input
              id="scheduling-max-slot"
              type="number"
              min={1}
              value={value.maxEventsPerSlot}
              onChange={(e) => onChange({ ...value, maxEventsPerSlot: e.target.value })}
              placeholder="Sem limite"
              disabled={fieldsDisabled}
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Os limites contam todas as reuniões da empresa. Além deles, cada horário precisa de pelo menos um atendente
          livre. Deixe vazio para não limitar.
        </p>
      </CardContent>
    </Card>
  );
}
