import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OptionsSelect } from "@/components/ui/options-select";
import { Textarea } from "@/components/ui/textarea";

export type MetadadoDraft = { key: string; id?: string; name: string; descricao: string; stageId: string | null };

export type StageOption = { id: string; label: string };

type MetadadosEditorProps = {
  value: MetadadoDraft[];
  onChange: (value: MetadadoDraft[]) => void;
  disabled?: boolean;
  /** Kanban columns ("Esteira › Coluna"); empty hides the selector. */
  stageOptions?: StageOption[];
};

export function MetadadosEditor({ value, onChange, disabled, stageOptions = [] }: MetadadosEditorProps) {
  function update(key: string, patch: Partial<MetadadoDraft>) {
    onChange(value.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  }

  return (
    <div className="space-y-3">
      {value.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Nenhum metadado. Adicione os dados que o agente deve perguntar e guardar de cada contato.
        </p>
      )}

      {value.map((item) => (
        <div key={item.key} className="space-y-2 rounded-md border p-3">
          <div className="flex gap-2">
            <Input
              value={item.name}
              onChange={(e) => update(item.key, { name: e.target.value })}
              placeholder="Nome (ex.: bairro)"
              disabled={disabled}
              className="flex-1"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Remover metadado"
              disabled={disabled}
              onClick={() => onChange(value.filter((m) => m.key !== item.key))}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
          <Textarea
            value={item.descricao}
            onChange={(e) => update(item.key, { descricao: e.target.value })}
            placeholder="Como perguntar, tratar e validar (ex.: Pergunte o bairro para calcular a entrega. Aceite só bairros de Curitiba.)"
            disabled={disabled}
            className="min-h-16"
          />
          {stageOptions.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              Ao coletar, mover o lead para
              <OptionsSelect
                value={item.stageId ?? ""}
                onValueChange={(stageId) => update(item.key, { stageId: stageId || null })}
                disabled={disabled}
                size="sm"
                className="w-auto min-w-48 flex-1"
                aria-label="Coluna do quadro ao coletar"
                options={[
                  { value: "", label: "Não mover" },
                  ...stageOptions.map((stage) => ({ value: stage.id, label: stage.label })),
                ]}
              />
            </div>
          )}
        </div>
      ))}

      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => onChange([...value, { key: crypto.randomUUID(), name: "", descricao: "", stageId: null }])}
      >
        <Plus className="h-4 w-4" />
        Adicionar metadado
      </Button>
    </div>
  );
}
