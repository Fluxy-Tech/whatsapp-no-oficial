import type { CSSProperties, ReactNode } from "react";
import fundoWhatsApp from "@/assets/FundoWhatsApp.jpg";
import { cn } from "@/lib/utils";

/** *negrito*, _itálico_ and ~tachado~ of WhatsApp rendered instead of the symbols. */
function renderFormatting(text: string): ReactNode[] {
  return text.split(/(\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~)/g).map((part, i) => {
    if (part.length > 2 && part.startsWith("*") && part.endsWith("*")) return <strong key={i}>{part.slice(1, -1)}</strong>;
    if (part.length > 2 && part.startsWith("_") && part.endsWith("_")) return <em key={i}>{part.slice(1, -1)}</em>;
    if (part.length > 2 && part.startsWith("~") && part.endsWith("~")) return <s key={i}>{part.slice(1, -1)}</s>;
    return part;
  });
}

/** The message as the contact sees it in WhatsApp (outgoing bubble). */
export function WhatsappPreview({ text, className }: { text: string; className?: string }) {
  return (
    <div
      className={cn(
        "flex items-start justify-center rounded-lg bg-[#e5ddd5] bg-repeat bg-[length:320px] p-6 [background-image:var(--wa-bg)]",
        className,
      )}
      style={{ "--wa-bg": `url(${fundoWhatsApp})` } as CSSProperties}
    >
      <div className="relative flex max-w-sm flex-col gap-1 rounded-lg rounded-tr-none bg-[#d9fdd3] p-3 text-sm text-black shadow-md">
        <div className="absolute right-0 top-0 size-0 translate-x-full border-r-8 border-t-8 border-r-transparent border-t-[#d9fdd3]" />
        {text.trim() ? (
          <p className="whitespace-pre-wrap break-words">{renderFormatting(text)}</p>
        ) : (
          <p className="italic text-gray-500">Escreva a mensagem para ver a pré-visualização.</p>
        )}
        <p className="text-right text-[10px] text-gray-500">
          {new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
        </p>
      </div>
    </div>
  );
}
