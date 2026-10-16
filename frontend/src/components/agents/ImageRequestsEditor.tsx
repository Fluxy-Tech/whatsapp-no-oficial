import { Plus, Trash2 } from "lucide-react";
import type { ImageRule } from "@/lib/agents";
import type { MetadadoDraft, StageOption } from "@/components/agents/MetadadosEditor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OptionsSelect } from "@/components/ui/options-select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

const RULE_TYPES: { value: ImageRule["type"]; label: string }[] = [
  { value: "noul", label: "Sim ou não (noul)" },
  { value: "choice", label: "Escolha entre opções (choice)" },
  { value: "score", label: "Nota por níveis (score)" },
];

function newRule(type: ImageRule["type"], base?: Pick<ImageRule, "id" | "label" | "instructions">): ImageRule {
  const common = base ?? { id: crypto.randomUUID(), label: "", instructions: "" };
  if (type === "choice") {
    return {
      ...common,
      type,
      options: [
        { name: "", description: "", accepted: true },
        { name: "", description: "", accepted: false },
      ],
    };
  }
  if (type === "score") return { ...common, type, levels: ["", "", ""], min: 1 };
  return { ...common, type: "noul", criteria: { true: "", false: "" }, min: 0.7 };
}

export function newImageRequest(): MetadadoDraft {
  return { key: crypto.randomUUID(), name: "", descricao: "", stageId: null, kind: "image", imageRules: [newRule("noul")] };
}

type RuleEditorProps = {
  rule: ImageRule;
  index: number;
  onChange: (rule: ImageRule) => void;
  onRemove: () => void;
  disabled?: boolean;
};

function RuleEditor({ rule, index, onChange, onRemove, disabled }: RuleEditorProps) {
  return (
    <div className="space-y-3 rounded-md border bg-muted/30 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">Regra {index + 1}</Badge>
        <Input
          value={rule.label}
          onChange={(e) => onChange({ ...rule, label: e.target.value })}
          placeholder="Nome da regra (ex.: Foto nítida)"
          disabled={disabled}
          className="h-8 min-w-0 flex-1 basis-40"
        />
        <OptionsSelect
          value={rule.type}
          onValueChange={(type) => onChange(newRule(type as ImageRule["type"], rule))}
          options={RULE_TYPES}
          disabled={disabled}
          size="sm"
          className="w-auto min-w-0 max-w-full flex-1 basis-56"
          aria-label="Tipo da regra"
        />
        <Button type="button" variant="ghost" size="icon" aria-label="Remover regra" disabled={disabled} onClick={onRemove}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <Textarea
        value={rule.instructions}
        onChange={(e) => onChange({ ...rule, instructions: e.target.value })}
        placeholder={
          rule.type === "noul"
            ? "Pergunta de sim ou não sobre a imagem (ex.: A foto mostra o documento inteiro, sem cortes?)"
            : rule.type === "choice"
              ? "O que o JEV deve escolher (ex.: Que tipo de documento aparece na imagem?)"
              : "O que o JEV deve avaliar (ex.: Quão legível está o texto da imagem?)"
        }
        disabled={disabled}
        className="min-h-14"
      />

      {rule.type === "noul" && (
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <Input
            value={rule.criteria.true}
            onChange={(e) => onChange({ ...rule, criteria: { ...rule.criteria, true: e.target.value } })}
            placeholder="O que é “sim” (opcional)"
            disabled={disabled}
          />
          <Input
            value={rule.criteria.false}
            onChange={(e) => onChange({ ...rule, criteria: { ...rule.criteria, false: e.target.value } })}
            placeholder="O que é “não” (opcional)"
            disabled={disabled}
          />
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Aprovar com
            <Input
              type="number"
              min={0}
              max={100}
              step={5}
              value={Math.round(rule.min * 100)}
              onChange={(e) => onChange({ ...rule, min: Math.min(Math.max(Number(e.target.value) || 0, 0), 100) / 100 })}
              disabled={disabled}
              className="h-8 w-20"
              aria-label="Probabilidade mínima de sim"
            />
            % de sim
          </label>
        </div>
      )}

      {rule.type === "choice" && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">Opções. Marque as que aprovam a imagem.</p>
          {rule.options.map((option, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <Input
                value={option.name}
                onChange={(e) =>
                  onChange({ ...rule, options: rule.options.map((o, j) => (j === i ? { ...o, name: e.target.value } : o)) })
                }
                placeholder="Opção (ex.: rg)"
                disabled={disabled}
                className="h-8 min-w-0 flex-1 basis-32"
              />
              <Input
                value={option.description}
                onChange={(e) =>
                  onChange({
                    ...rule,
                    options: rule.options.map((o, j) => (j === i ? { ...o, description: e.target.value } : o)),
                  })
                }
                placeholder="Descrição (ex.: Carteira de identidade, frente ou verso)"
                disabled={disabled}
                className="h-8 min-w-0 flex-[2] basis-48"
              />
              <label className="flex items-center gap-2 text-xs">
                <Switch
                  checked={option.accepted}
                  onCheckedChange={(accepted) =>
                    onChange({ ...rule, options: rule.options.map((o, j) => (j === i ? { ...o, accepted } : o)) })
                  }
                  disabled={disabled}
                  aria-label="Opção aprova a imagem"
                />
                {option.accepted ? "Aprova" : "Reprova"}
              </label>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Remover opção"
                disabled={disabled || rule.options.length <= 2}
                onClick={() => onChange({ ...rule, options: rule.options.filter((_, j) => j !== i) })}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || rule.options.length >= 20}
            onClick={() => onChange({ ...rule, options: [...rule.options, { name: "", description: "", accepted: false }] })}
          >
            <Plus className="h-4 w-4" />
            Opção
          </Button>
        </div>
      )}

      {rule.type === "score" && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">Níveis, do pior para o melhor.</p>
          {rule.levels.map((level, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-14 shrink-0 text-xs text-muted-foreground">Nível {i}</span>
              <Input
                value={level}
                onChange={(e) => onChange({ ...rule, levels: rule.levels.map((l, j) => (j === i ? e.target.value : l)) })}
                placeholder={i === 0 ? "Ex.: Ilegível" : i === rule.levels.length - 1 ? "Ex.: Perfeita" : "Ex.: Legível"}
                disabled={disabled}
                className="h-8 min-w-0 flex-1"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Remover nível"
                disabled={disabled || rule.levels.length <= 2}
                onClick={() => {
                  const levels = rule.levels.filter((_, j) => j !== i);
                  onChange({ ...rule, levels, min: Math.min(rule.min, levels.length - 1) });
                }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled || rule.levels.length >= 10}
              onClick={() => onChange({ ...rule, levels: [...rule.levels, ""] })}
            >
              <Plus className="h-4 w-4" />
              Nível
            </Button>
            <span className="text-xs text-muted-foreground">Aprovar a partir do</span>
            <OptionsSelect
              value={String(rule.min)}
              onValueChange={(min) => onChange({ ...rule, min: Number(min) })}
              options={rule.levels.map((level, i) => ({ value: String(i), label: `Nível ${i}${level ? ` (${level})` : ""}` }))}
              disabled={disabled}
              size="sm"
              className="w-auto min-w-0 max-w-full flex-1 basis-40"
              aria-label="Nível mínimo para aprovar"
            />
          </div>
        </div>
      )}
    </div>
  );
}

type ImageRequestsEditorProps = {
  value: MetadadoDraft[];
  onChange: (value: MetadadoDraft[]) => void;
  disabled?: boolean;
  stageOptions?: StageOption[];
};

/** "image" metadados: what to ask for and the JEV rules that approve the image. */
export function ImageRequestsEditor({ value, onChange, disabled, stageOptions = [] }: ImageRequestsEditorProps) {
  function update(key: string, patch: Partial<MetadadoDraft>) {
    onChange(value.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  }

  return (
    <div className="space-y-3">
      {value.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Nenhuma imagem. Adicione as imagens que o agente deve pedir ao contato, como documento, comprovante ou foto
          do produto.
        </p>
      )}

      {value.map((item) => (
        <div key={item.key} className="space-y-3 rounded-md border p-3">
          <div className="flex gap-2">
            <Input
              value={item.name}
              onChange={(e) => update(item.key, { name: e.target.value })}
              placeholder="Nome do metadado (ex.: documento)"
              disabled={disabled}
              className="flex-1"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Remover imagem"
              disabled={disabled}
              onClick={() => onChange(value.filter((m) => m.key !== item.key))}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
          <Textarea
            value={item.descricao}
            onChange={(e) => update(item.key, { descricao: e.target.value })}
            placeholder="Quando e como pedir a imagem (ex.: Depois do nome, peça uma foto da frente do RG, sem flash e mostrando o documento inteiro.)"
            disabled={disabled}
            className="min-h-16"
          />

          <div className="space-y-2">
            <Label>Regras de validação (JEV)</Label>
            {item.imageRules.map((rule, index) => (
              <RuleEditor
                key={rule.id}
                rule={rule}
                index={index}
                disabled={disabled}
                onChange={(next) =>
                  update(item.key, { imageRules: item.imageRules.map((r) => (r.id === rule.id ? next : r)) })
                }
                onRemove={() => update(item.key, { imageRules: item.imageRules.filter((r) => r.id !== rule.id) })}
              />
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled || item.imageRules.length >= 10}
              onClick={() => update(item.key, { imageRules: [...item.imageRules, newRule("noul")] })}
            >
              <Plus className="h-4 w-4" />
              Adicionar regra
            </Button>
          </div>

          {stageOptions.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              Ao aprovar, mover o lead para
              <OptionsSelect
                value={item.stageId ?? ""}
                onValueChange={(stageId) => update(item.key, { stageId: stageId || null })}
                disabled={disabled}
                size="sm"
                className="w-auto min-w-0 max-w-full flex-1 basis-48"
                aria-label="Coluna do quadro ao aprovar"
                options={[
                  { value: "", label: "Não mover" },
                  ...stageOptions.map((stage) => ({ value: stage.id, label: stage.label })),
                ]}
              />
            </div>
          )}
        </div>
      ))}

      <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => onChange([...value, newImageRequest()])}>
        <Plus className="h-4 w-4" />
        Adicionar imagem
      </Button>
    </div>
  );
}
