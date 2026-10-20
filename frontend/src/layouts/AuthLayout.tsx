import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Bot, CalendarCheck2, KanbanSquare } from "lucide-react";
import logo from "@/assets/getleads-marca.png";
import icon from "@/assets/IconeSemFundo.png";

const POINTS = [
  { icon: Bot, text: "Agente de IA que responde como gente, 24 horas" },
  { icon: KanbanSquare, text: "Cada lead qualificado cai direto no seu quadro" },
  { icon: CalendarCheck2, text: "Reuniões marcadas e remarcadas na conversa" },
];

// Split screen for login/register: form on the left, brand panel on the right.
// The panel is hidden on small screens so the form takes the full width.
export function AuthLayout({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh bg-background">
      <div className="flex w-full flex-col px-6 py-8 sm:px-10 lg:w-[46%]">
        <div className="flex items-center justify-between">
          <Link to="/">
            <img src={logo} alt="GetLeads" className="h-8 w-auto" />
          </Link>
          <Link
            to="/"
            className="flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Site
          </Link>
        </div>

        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-12">
          <div className="animate-fade-up">
            <h1 className="text-3xl font-semibold">{title}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{description}</p>
            <div className="mt-8">{children}</div>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">© {new Date().getFullYear()} GetLeads. Todos os direitos reservados.</p>
      </div>

      <div className="relative hidden flex-1 overflow-hidden bg-zinc-950 text-white lg:block">
        <div className="bg-grid absolute inset-0" />
        <div className="noise absolute inset-0 opacity-[0.07] mix-blend-overlay" />
        <div className="absolute left-1/2 top-[-20%] h-[36rem] w-[36rem] -translate-x-1/2 rounded-full bg-white/10 blur-[120px]" />

        <div className="relative flex h-full flex-col justify-between p-12 xl:p-16">
          <img src={icon} alt="" className="h-10 w-10 opacity-90 invert" />

          <div className="max-w-lg">
            <p className="font-display text-5xl leading-[1.05] xl:text-6xl">
              Seu WhatsApp vendendo <span className="italic text-white/60">enquanto</span> você dorme.
            </p>
            <ul className="mt-10 space-y-4">
              {POINTS.map(({ icon: Icon, text }) => (
                <li key={text} className="flex items-center gap-3 text-sm text-white/75">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/5">
                    <Icon className="h-4 w-4" />
                  </span>
                  {text}
                </li>
              ))}
            </ul>
          </div>

          <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white font-display text-lg italic text-zinc-950">
              M
            </span>
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-medium">Marina Souza</p>
              <p className="truncate text-white/60">“Reservei sábado às 10h, obrigada! Super rápido.”</p>
            </div>
            <span className="rounded-full bg-emerald-400/15 px-2.5 py-1 text-[11px] font-medium text-emerald-300">
              Agendado
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
