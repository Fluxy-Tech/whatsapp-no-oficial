import {
  Bot,
  CalendarCheck2,
  CheckCheck,
  KanbanSquare,
  LayoutDashboard,
  Megaphone,
  MessageSquare,
  Settings,
  Sparkles,
  Target,
} from "lucide-react";
import { cn } from "@/lib/utils";
import icon from "@/assets/IconeSemFundo.png";

// Static illustration of the app for the landing page: a conversation handled
// by the agent (RGBS messages) next to the lead it fills in on the CRM.

type Bubble = { from: "contact" | "agent"; text: string; time: string };

const CONVERSATION: Bubble[] = [
  { from: "contact", text: "Oi! Vocês fazem atendimento no sábado?", time: "09:12" },
  { from: "agent", text: "Oi, Marina! Tudo bem? 😊", time: "09:12" },
  { from: "agent", text: "Fazemos sim, das 9h às 13h.", time: "09:12" },
  { from: "agent", text: "Quer que eu já reserve um horário pra você?", time: "09:13" },
  { from: "contact", text: "Quero! Sábado às 10h dá?", time: "09:13" },
  { from: "agent", text: "Prontinho, reservei sábado às 10h ✅", time: "09:13" },
];

const SIDEBAR = [LayoutDashboard, KanbanSquare, MessageSquare, Target, Megaphone, Bot, Settings];

export function ProductMockup({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "relative rounded-[1.4rem] border border-white/10 bg-white/[0.04] p-2 shadow-[0_40px_120px_-30px_oklch(0%_0_0/0.9)] backdrop-blur",
        className,
      )}
    >
      <div className="overflow-hidden rounded-2xl border border-black/5 bg-white text-zinc-900">
        {/* Window bar */}
        <div className="flex items-center gap-2 border-b border-zinc-100 bg-zinc-50/80 px-4 py-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-zinc-300" />
          <span className="h-2.5 w-2.5 rounded-full bg-zinc-300" />
          <span className="h-2.5 w-2.5 rounded-full bg-zinc-300" />
          <span className="mx-auto hidden rounded-md bg-white px-3 py-0.5 text-[11px] text-zinc-400 ring-1 ring-zinc-200 sm:block">
            GetLeads · Conversas
          </span>
        </div>

        <div className="flex h-[25rem] text-left sm:h-[27rem]">
          {/* Sidebar */}
          <div className="hidden w-14 shrink-0 flex-col items-center gap-3 border-r border-zinc-100 py-4 sm:flex">
            <img src={icon} alt="" className="mb-2 h-7 w-7" />
            {SIDEBAR.map((Icon, index) => (
              <span
                key={index}
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400",
                  index === 2 && "bg-zinc-900 text-white",
                )}
              >
                <Icon className="h-4 w-4" />
              </span>
            ))}
          </div>

          {/* Chat */}
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-center gap-3 border-b border-zinc-100 px-4 py-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-amber-200 to-rose-300 text-xs font-semibold text-rose-900">
                MS
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">Marina Souza</p>
                <p className="flex items-center gap-1 text-[11px] text-emerald-600">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  online
                </p>
              </div>
              <span className="flex items-center gap-1 rounded-full bg-zinc-900 px-2.5 py-1 text-[10px] font-medium text-white">
                <Sparkles className="h-3 w-3" />
                Agente ativo
              </span>
            </div>

            <div className="flex-1 space-y-1.5 overflow-hidden bg-[oklch(97%_0.01_95)] px-4 py-4">
              {CONVERSATION.map((bubble, index) => (
                <div key={index} className={cn("flex", bubble.from === "agent" ? "justify-end" : "justify-start")}>
                  <div
                    className={cn(
                      "max-w-[78%] rounded-xl px-3 py-1.5 text-[12.5px] leading-snug shadow-[0_1px_1px_oklch(0%_0_0/0.08)]",
                      bubble.from === "agent" ? "rounded-tr-sm bg-[oklch(93%_0.07_150)]" : "rounded-tl-sm bg-white",
                      // A gap before each new speaker, like WhatsApp groups bubbles.
                      index > 0 && CONVERSATION[index - 1].from !== bubble.from && "mt-3",
                    )}
                  >
                    {bubble.text}
                    <span className="ml-2 inline-flex translate-y-0.5 items-center gap-0.5 text-[10px] text-zinc-500">
                      {bubble.time}
                      {bubble.from === "agent" && <CheckCheck className="h-3 w-3 text-sky-500" />}
                    </span>
                  </div>
                </div>
              ))}
              <div className="flex justify-start pt-2">
                <div className="flex items-center gap-1 rounded-xl rounded-tl-sm bg-white px-3 py-2.5 shadow-[0_1px_1px_oklch(0%_0_0/0.08)]">
                  {[0, 150, 300].map((delay) => (
                    <span
                      key={delay}
                      className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-400"
                      style={{ animationDelay: `${delay}ms` }}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Lead panel */}
          <div className="hidden w-56 shrink-0 flex-col gap-3 border-l border-zinc-100 bg-zinc-50/60 p-4 lg:flex">
            <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">Lead</p>
            <div className="space-y-2 rounded-xl border border-zinc-200/80 bg-white p-3 shadow-sm">
              <p className="text-sm font-semibold">Marina Souza</p>
              <span className="inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 ring-1 ring-emerald-200">
                Qualificado
              </span>
              <dl className="space-y-1.5 pt-1 text-[11px]">
                {[
                  ["Interesse", "Avaliação"],
                  ["Cidade", "Campinas"],
                  ["Origem", "WhatsApp"],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-2">
                    <dt className="text-zinc-400">{label}</dt>
                    <dd className="font-medium">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <div className="flex items-start gap-2 rounded-xl border border-zinc-200/80 bg-white p-3 shadow-sm">
              <CalendarCheck2 className="mt-0.5 h-4 w-4 text-zinc-900" />
              <div>
                <p className="text-xs font-semibold">Reunião agendada</p>
                <p className="text-[11px] text-zinc-500">Sábado, 10:00 · 60 min</p>
              </div>
            </div>
            <div className="mt-auto rounded-xl bg-zinc-900 p-3 text-white">
              <p className="text-[10px] uppercase tracking-wider text-white/50">Quadro</p>
              <p className="text-xs font-medium">Movido para "Agendado"</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
