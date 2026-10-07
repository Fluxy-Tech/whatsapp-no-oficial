import { useState } from "react";
import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type KeywordsInputProps = {
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
};

// Same comparison the AI-Worker uses: case, accents and punctuation don't matter.
const normalize = (value: string) =>
  value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

export function KeywordsInput({ value, onChange, placeholder, disabled }: KeywordsInputProps) {
  const [draft, setDraft] = useState("");

  function add() {
    const keyword = draft.trim();
    if (!keyword || !normalize(keyword)) return;
    if (!value.some((existing) => normalize(existing) === normalize(keyword))) onChange([...value, keyword]);
    setDraft("");
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder={placeholder}
          disabled={disabled}
        />
        <Button type="button" variant="outline" onClick={add} disabled={disabled || !draft.trim()}>
          Adicionar
        </Button>
      </div>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((keyword) => (
            <Badge key={keyword} variant="secondary" className="gap-1 pr-1 font-normal">
              {keyword}
              {!disabled && (
                <button
                  type="button"
                  aria-label={`Remover ${keyword}`}
                  className="rounded-full p-0.5 hover:bg-background"
                  onClick={() => onChange(value.filter((k) => k !== keyword))}
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
