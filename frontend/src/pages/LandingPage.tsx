import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  ArrowUpRight,
  Ban,
  BarChart3,
  Bot,
  BrainCircuit,
  CalendarCheck2,
  CalendarDays,
  Check,
  FileSpreadsheet,
  FileText,
  Gauge,
  ImageUp,
  KanbanSquare,
  KeyRound,
  Layers,
  ListChecks,
  Megaphone,
  MessageSquare,
  MessagesSquare,
  Minus,
  Plus,
  QrCode,
  RefreshCcw,
  ShieldCheck,
  Sparkles,
  Target,
  Timer,
  Users,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import logo from "@/assets/getleads-marca.png";
import icon from "@/assets/IconeSemFundo.png";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { ProductMockup } from "@/components/landing/ProductMockup";
import { Reveal } from "@/components/landing/Reveal";
import { RgbsDemo } from "@/components/landing/RgbsDemo";

const NAV = [
  { label: "Produto", href: "#produto" },
  { label: "Agente de IA", href: "#agente" },
  { label: "Como funciona", href: "#como-funciona" },
  { label: "Campanhas", href: "#campanhas" },
  { label: "FAQ", href: "#faq" },
];

const MARQUEE = [
  "Agentes de IA",
  "RGBS",
  "Base de conhecimento (RAG)",
  "Coleta de metadados",
  "Validação de imagens",
  "Agendamento automático",
  "CRM em quadro",
  "Calendário",
  "Campanhas em massa",
  "Bloqueio por frase",
  "Reconexão automática",
  "Permissões por cargo",
  "Multi-empresa",
  "Consumo de tokens",
];

type Module = { icon: LucideIcon; title: string; text: string; className?: string };

const MODULES: Module[] = [
  {
    icon: Bot,
    title: "Agentes de IA",
    text: "Atendem cada contato no WhatsApp com o seu tom de voz, consultam seus documentos e coletam os dados que você precisa.",
    className: "md:col-span-2",
  },
  {
    icon: MessageSquare,
    title: "Conversas ao vivo",
    text: "Todas as conversas em tempo real, com mídias, e o agente liga e desliga por contato.",
  },
  {
    icon: KanbanSquare,
    title: "CRM em quadro",
    text: "Esteiras e colunas sob medida. O lead muda de coluna sozinho quando o agente qualifica.",
  },
  {
    icon: CalendarDays,
    title: "Calendário",
    text: "Reuniões marcadas pela equipe ou pela IA, com responsável e lead vinculados.",
  },
  {
    icon: Target,
    title: "Leads",
    text: "Base completa dos contatos com tudo o que o agente descobriu em cada conversa.",
  },
  {
    icon: Megaphone,
    title: "Campanhas",
    text: "Disparo em massa por CSV ou manual, com variáveis, lotes, agenda e histórico de respostas.",
    className: "md:col-span-2",
  },
  {
    icon: BarChart3,
    title: "Dashboard",
    text: "Leads registrados, agendas criadas e interações mês a mês.",
  },
];

const AGENT_FEATURES: { icon: LucideIcon; title: string; text: string }[] = [
  {
    icon: FileText,
    title: "Base de conhecimento",
    text: "Suba PDFs e documentos. O agente busca as respostas neles (RAG) em vez de inventar.",
  },
  {
    icon: ListChecks,
    title: "Coleta de metadados",
    text: "Nome, cidade, interesse, sim/não, múltipla escolha ou nota por níveis. Tudo cai na ficha do lead.",
  },
  {
    icon: ImageUp,
    title: "Validação de imagens",
    text: "O contato envia um comprovante ou documento e a IA analisa e aprova conforme as suas regras.",
  },
  {
    icon: CalendarCheck2,
    title: "Agenda e remarca",
    text: "Consulta horários livres, marca a reunião e remarca quando o contato pede, sem ninguém da equipe.",
  },
  {
    icon: Workflow,
    title: "Automação no quadro",
    text: "Ao coletar os dados ou aprovar uma imagem, o lead vai para a coluna certa e ganha um responsável.",
  },
  {
    icon: Timer,
    title: "Espera inteligente",
    text: "Aguarda o contato terminar de digitar antes de responder, para entender a mensagem inteira.",
  },
  {
    icon: ShieldCheck,
    title: "Plano B em falhas",
    text: "Se algo der errado, o contato recebe uma mensagem sua e a equipe é avisada no WhatsApp.",
  },
  {
    icon: Gauge,
    title: "Consumo transparente",
    text: "Painel de tokens por agente e por função: conversa, documentos, buscas e imagens.",
  },
];

const STEPS: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: QrCode, title: "Conecte o WhatsApp", text: "Leia o QR Code com o celular da empresa. Pronto, o número está na plataforma." },
  { icon: BrainCircuit, title: "Configure o agente", text: "Escreva como ele deve atender, suba seus documentos e escolha as funções." },
  { icon: MessagesSquare, title: "Ele atende e qualifica", text: "Responde em segundos, coleta os dados, valida imagens e marca reuniões." },
  { icon: KanbanSquare, title: "Sua equipe fecha", text: "O lead chega pronto no quadro, com histórico, ficha e reunião agendada." },
];

const CAMPAIGN_POINTS = [
  { icon: FileSpreadsheet, text: "Lista em CSV com telefone, nome e variáveis {{1}}, {{2}}..." },
  { icon: Layers, text: "Envio em lotes, com intervalo entre eles para proteger o número" },
  { icon: CalendarDays, text: "Disparo agendado para a data e hora que você escolher" },
  { icon: Ban, text: "Bloqueio automático quando o contato responde “parar”, “sair”..." },
  { icon: RefreshCcw, text: "Pausa sozinha se o WhatsApp cair e retoma quando reconectar" },
];

const ROLES = [
  { name: "Administrador", text: "Controle total da empresa" },
  { name: "Gerente", text: "Equipe, convites e acessos" },
  { name: "Supervisor", text: "Acompanha a operação" },
  { name: "Atendente", text: "Conversa e atende leads" },
];

const FAQ = [
  {
    q: "Preciso trocar de número de WhatsApp?",
    a: "Não. Você conecta o número que já usa lendo um QR Code, como no WhatsApp Web. As conversas continuam no seu celular.",
  },
  {
    q: "O agente responde qualquer coisa?",
    a: "Ele segue o prompt que você escreve e consulta os documentos que você sobe. Você define o que ele coleta, quando agenda e para qual coluna o lead vai.",
  },
  {
    q: "Dá para pausar o agente para um contato?",
    a: "Sim. Em cada lead existe um botão para ligar ou desligar o agente. A equipe assume a conversa quando quiser.",
  },
  {
    q: "E se o WhatsApp desconectar?",
    a: "Um vigia de conexão tenta reconectar sozinho. Enquanto isso, as campanhas em andamento ficam pausadas e retomam quando o número volta.",
  },
  {
    q: "Posso ter mais de uma empresa?",
    a: "Sim. Uma conta participa de várias empresas, cada uma com seu WhatsApp, agentes, equipe e permissões. Convites são feitos por código.",
  },
  {
    q: "Quem da equipe vê o quê?",
    a: "Cada cargo tem acesso por módulo: sem acesso, só ver ou ver e editar. O gerente ajusta isso nas configurações.",
  },
];

function Eyebrow({ children, dark = false }: { children: React.ReactNode; dark?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium",
        dark ? "border-white/15 bg-white/5 text-white/70" : "border-border bg-background text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

function SectionTitle({
  eyebrow,
  title,
  text,
  dark = false,
  center = false,
}: {
  eyebrow: string;
  title: React.ReactNode;
  text?: string;
  dark?: boolean;
  center?: boolean;
}) {
  return (
    <Reveal className={cn("max-w-2xl", center && "mx-auto text-center")}>
      <Eyebrow dark={dark}>{eyebrow}</Eyebrow>
      <h2 className={cn("mt-5 text-4xl font-semibold leading-[1.05] sm:text-5xl", dark && "text-white")}>{title}</h2>
      {text && <p className={cn("mt-5 text-lg leading-relaxed", dark ? "text-white/60" : "text-muted-foreground")}>{text}</p>}
    </Reveal>
  );
}

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-border">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-6 py-6 text-left text-lg font-medium"
      >
        {q}
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border">
          {open ? <Minus className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
        </span>
      </button>
      <div className={cn("grid transition-all duration-300", open ? "grid-rows-[1fr] pb-6" : "grid-rows-[0fr]")}>
        <p className="overflow-hidden pr-14 leading-relaxed text-muted-foreground">{a}</p>
      </div>
    </div>
  );
}

/** "/": portfolio of the whole product. */
export function LandingPage() {
  const { data: session } = authClient.useSession();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const primaryCta = session
    ? { label: "Abrir plataforma", to: "/dashboard" }
    : { label: "Começar agora", to: "/register" };

  return (
    <div className="min-h-dvh overflow-x-clip bg-background text-foreground">
      {/* Nav */}
      <header
        className={cn(
          "fixed inset-x-0 top-0 z-50 transition-all duration-300",
          scrolled ? "border-b border-white/10 bg-zinc-950/75 backdrop-blur-xl" : "bg-transparent",
        )}
      >
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-6 px-5 sm:px-8">
          <a href="#topo" className="shrink-0">
            <img src={logo} alt="GetLeads" className="h-7 w-auto invert" />
          </a>
          <nav className="hidden items-center gap-1 lg:flex">
            {NAV.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="rounded-full px-3.5 py-1.5 text-sm text-white/60 transition-colors hover:bg-white/5 hover:text-white"
              >
                {item.label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            {!session && (
              <Link
                to="/login"
                className="hidden rounded-full px-4 py-2 text-sm text-white/70 transition-colors hover:text-white sm:block"
              >
                Entrar
              </Link>
            )}
            <Link
              to={primaryCta.to}
              className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-sm font-medium text-zinc-950 transition-transform hover:scale-[1.03] active:scale-[0.98]"
            >
              {primaryCta.label}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section id="topo" className="relative overflow-hidden bg-zinc-950 pb-24 pt-36 text-white sm:pt-44">
        <div className="bg-grid pointer-events-none absolute inset-0" />
        <div className="noise pointer-events-none absolute inset-0 opacity-[0.06] mix-blend-overlay" />
        <div className="pointer-events-none absolute left-1/2 top-0 h-[40rem] w-[60rem] -translate-x-1/2 -translate-y-1/3 rounded-full bg-white/[0.09] blur-[140px]" />

        <div className="relative mx-auto max-w-7xl px-5 sm:px-8">
          <div className="mx-auto max-w-4xl text-center">
            <div className="animate-fade-up">
              <Eyebrow dark>
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
                </span>
                Agentes de IA para WhatsApp
              </Eyebrow>
            </div>
            <h1 className="mt-7 animate-fade-up text-5xl font-semibold leading-[0.98] [animation-delay:80ms] sm:text-7xl lg:text-[5.5rem]">
              <span className="text-silver">Seu WhatsApp</span>
              <br />
              <span className="font-display font-normal italic text-white">atendendo, qualificando</span>
              <br />
              <span className="text-silver">e vendendo.</span>
            </h1>
            <p className="mx-auto mt-8 max-w-2xl animate-fade-up text-lg leading-relaxed text-white/60 [animation-delay:160ms] sm:text-xl">
              O GetLeads coloca um agente de IA no seu número, responde como gente, coleta os dados do lead, marca a
              reunião e entrega tudo no seu CRM. Sua equipe só entra para fechar.
            </p>
            <div className="mt-10 flex animate-fade-up flex-col items-center justify-center gap-3 [animation-delay:240ms] sm:flex-row">
              <Link
                to={primaryCta.to}
                className="group inline-flex h-12 items-center gap-2 rounded-full bg-white px-7 text-[15px] font-medium text-zinc-950 shadow-[0_0_0_6px_oklch(100%_0_0/0.08)] transition-transform hover:scale-[1.03] active:scale-[0.98]"
              >
                {primaryCta.label}
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
              <a
                href="#produto"
                className="inline-flex h-12 items-center gap-2 rounded-full border border-white/15 px-7 text-[15px] text-white/80 transition-colors hover:border-white/30 hover:bg-white/5 hover:text-white"
              >
                Conhecer a plataforma
              </a>
            </div>
            <p className="mt-6 animate-fade-up text-xs text-white/40 [animation-delay:300ms]">
              Conecta com QR Code · Sem trocar de número · Multi-empresa
            </p>
          </div>

          <div className="relative mx-auto mt-20 max-w-6xl animate-fade-up [animation-delay:380ms]">
            <div className="pointer-events-none absolute -inset-x-10 -top-10 bottom-0 rounded-[3rem] bg-gradient-to-b from-white/10 to-transparent blur-2xl" />
            <ProductMockup className="relative" />

            {/* Floating proof cards */}
            <div className="absolute -left-6 top-24 hidden animate-float rounded-2xl border border-white/10 bg-zinc-900/90 p-4 shadow-float backdrop-blur xl:block">
              <p className="text-[11px] uppercase tracking-[0.12em] text-white/40">Tempo de resposta</p>
              <p className="mt-1 text-2xl font-semibold">segundos</p>
              <p className="text-xs text-white/50">a qualquer hora do dia</p>
            </div>
            <div className="absolute -right-6 bottom-20 hidden animate-float rounded-2xl border border-white/10 bg-zinc-900/90 p-4 shadow-float backdrop-blur [animation-delay:1.5s] xl:block">
              <p className="flex items-center gap-2 text-sm font-medium">
                <Sparkles className="h-4 w-4" />
                Lead qualificado
              </p>
              <p className="mt-1 text-xs text-white/50">4 metadados coletados · movido no quadro</p>
            </div>
          </div>
        </div>
      </section>

      {/* Marquee */}
      <div className="relative overflow-hidden border-y border-white/10 bg-zinc-950 py-5 text-white/50">
        <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-32 bg-gradient-to-r from-zinc-950" />
        <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-32 bg-gradient-to-l from-zinc-950" />
        <div className="flex w-max animate-marquee gap-10 whitespace-nowrap">
          {[...MARQUEE, ...MARQUEE].map((item, index) => (
            <span key={index} className="flex items-center gap-10 text-sm">
              {item}
              <span className="h-1 w-1 rounded-full bg-white/25" />
            </span>
          ))}
        </div>
      </div>

      {/* Problem → answer */}
      <section className="relative py-28 sm:py-36">
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          <div className="grid gap-16 lg:grid-cols-[1fr_1.2fr] lg:items-end">
            <SectionTitle
              eyebrow="Por que GetLeads"
              title={
                <>
                  Lead que espera, <span className="font-display font-normal italic">esfria.</span>
                </>
              }
              text="Mensagem sem resposta à noite, dados perdidos no chat, reunião que ninguém marcou. O GetLeads resolve o caminho inteiro, do primeiro “oi” até o card no quadro."
            />
            <div className="grid gap-px overflow-hidden rounded-2xl border bg-border sm:grid-cols-3">
              {[
                { before: "Resposta só em horário comercial", after: "Atendimento imediato, 24h por dia" },
                { before: "Dados soltos nas conversas", after: "Ficha do lead preenchida pela IA" },
                { before: "Agenda marcada na mão", after: "Reunião marcada e remarcada no chat" },
              ].map((item, index) => (
                <Reveal key={item.after} delay={index * 90} className="h-full">
                  <div className="flex h-full flex-col justify-between gap-10 bg-background p-6">
                    <p className="text-sm text-muted-foreground line-through decoration-muted-foreground/40">
                      {item.before}
                    </p>
                    <p className="flex items-start gap-2 text-lg font-medium leading-snug">
                      <Check className="mt-1 h-4 w-4 shrink-0" />
                      {item.after}
                    </p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Product bento */}
      <section id="produto" className="relative scroll-mt-16 bg-muted/50 py-28 sm:py-36">
        <div className="bg-grid-light pointer-events-none absolute inset-0" />
        <div className="relative mx-auto max-w-7xl px-5 sm:px-8">
          <SectionTitle
            center
            eyebrow="A plataforma"
            title={
              <>
                Tudo o que o seu comercial precisa, <span className="font-display font-normal italic">num só lugar.</span>
              </>
            }
            text="Sete módulos que conversam entre si. O que o agente descobre no chat aparece no lead, no quadro e no calendário."
          />
          <div className="mt-16 grid gap-4 md:grid-cols-4">
            {MODULES.map((module, index) => {
              const Icon = module.icon;
              return (
                <Reveal key={module.title} delay={(index % 4) * 80} className={module.className}>
                  <div className="group relative h-full overflow-hidden rounded-2xl border border-border/80 bg-background p-7 shadow-soft transition-all duration-300 hover:-translate-y-1 hover:shadow-float">
                    <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-110">
                      <Icon className="h-5 w-5" />
                    </span>
                    <h3 className="mt-8 text-xl font-semibold">{module.title}</h3>
                    <p className="mt-2 leading-relaxed text-muted-foreground">{module.text}</p>
                    <ArrowUpRight className="absolute right-6 top-6 h-5 w-5 text-muted-foreground/40 transition-all group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-foreground" />
                  </div>
                </Reveal>
              );
            })}
            <Reveal delay={240}>
              <div className="flex h-full flex-col justify-between rounded-2xl bg-zinc-950 p-7 text-white">
                <img src={icon} alt="" className="h-10 w-10 invert" />
                <div>
                  <p className="font-display text-3xl italic leading-tight">Um número. Uma equipe. Zero lead perdido.</p>
                </div>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* AI agent deep dive */}
      <section id="agente" className="scroll-mt-16 py-28 sm:py-36">
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          <div className="grid gap-16 lg:grid-cols-[0.9fr_1.1fr]">
            <div className="lg:sticky lg:top-28 lg:self-start">
              <SectionTitle
                eyebrow="Agente de IA"
                title={
                  <>
                    Um vendedor que <span className="font-display font-normal italic">nunca</span> sai do turno.
                  </>
                }
                text="Cada empresa cria quantos agentes quiser e escolhe qual está em uso. Você escreve o prompt, sobe os documentos e liga as funções. Ele cuida do resto."
              />
              <Reveal delay={120}>
                <div className="mt-10 rounded-2xl border bg-muted/40 p-5">
                  <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Funcionando com</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {["Google ADK + Gemini", "OpenAI (RAG)", "pgvector", "JEV · TypeSafe"].map((tech) => (
                      <span key={tech} className="rounded-full border bg-background px-3 py-1 text-sm">
                        {tech}
                      </span>
                    ))}
                  </div>
                </div>
              </Reveal>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {AGENT_FEATURES.map((feature, index) => {
                const Icon = feature.icon;
                return (
                  <Reveal key={feature.title} delay={(index % 2) * 90}>
                    <div className="group h-full rounded-2xl border p-6 transition-colors hover:border-foreground/25 hover:bg-muted/40">
                      <span className="flex h-10 w-10 items-center justify-center rounded-lg border bg-background transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                        <Icon className="h-[18px] w-[18px]" />
                      </span>
                      <h3 className="mt-5 font-semibold">{feature.title}</h3>
                      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{feature.text}</p>
                    </div>
                  </Reveal>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* RGBS */}
      <section className="relative overflow-hidden bg-zinc-950 py-28 text-white sm:py-36">
        <div className="bg-grid pointer-events-none absolute inset-0 rotate-180" />
        <div className="relative mx-auto max-w-7xl px-5 sm:px-8">
          <div className="grid gap-16 lg:grid-cols-2 lg:items-center">
            <div>
              <SectionTitle
                dark
                eyebrow="Exclusivo · RGBS"
                title={
                  <>
                    Ninguém percebe que é <span className="font-display font-normal italic text-white/70">IA.</span>
                  </>
                }
                text="O RGBS (Recebe, Gera, Quebra e Envia) divide a resposta em mensagens curtas e envia uma de cada vez, com o tempo que uma pessoa levaria para digitar."
              />
              <Reveal delay={120}>
                <dl className="mt-10 grid grid-cols-4 gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10">
                  {[
                    ["R", "Recebe"],
                    ["G", "Gera"],
                    ["B", "Quebra"],
                    ["S", "Envia"],
                  ].map(([letter, word]) => (
                    <div key={letter} className="bg-zinc-950 p-4 text-center">
                      <dt className="font-display text-4xl italic">{letter}</dt>
                      <dd className="mt-1 text-xs text-white/50">{word}</dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-4 text-sm text-white/40">
                  Tempos ajustáveis por agente para mensagens pequenas, médias e grandes.
                </p>
              </Reveal>
            </div>
            <Reveal delay={150}>
              <RgbsDemo />
            </Reveal>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="como-funciona" className="scroll-mt-16 py-28 sm:py-36">
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          <SectionTitle
            center
            eyebrow="Como funciona"
            title={
              <>
                No ar em <span className="font-display font-normal italic">quatro passos.</span>
              </>
            }
          />
          <div className="relative mt-20 grid gap-10 md:grid-cols-4 md:gap-6">
            <div className="pointer-events-none absolute left-0 right-0 top-7 hidden h-px bg-gradient-to-r from-transparent via-border to-transparent md:block" />
            {STEPS.map((step, index) => {
              const Icon = step.icon;
              return (
                <Reveal key={step.title} delay={index * 110}>
                  <div className="relative text-center md:px-2">
                    <span className="relative mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-float">
                      <Icon className="h-6 w-6" />
                      <span className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full border-2 border-background bg-background font-display text-sm italic text-foreground">
                        {index + 1}
                      </span>
                    </span>
                    <h3 className="mt-6 text-lg font-semibold">{step.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{step.text}</p>
                  </div>
                </Reveal>
              );
            })}
          </div>
        </div>
      </section>

      {/* Campaigns */}
      <section id="campanhas" className="scroll-mt-16 pb-28 sm:pb-36">
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          <div className="overflow-hidden rounded-[2rem] border bg-muted/40">
            <div className="grid lg:grid-cols-2">
              <div className="p-8 sm:p-14">
                <SectionTitle
                  eyebrow="Campanhas"
                  title={
                    <>
                      Disparos em massa, <span className="font-display font-normal italic">com cuidado.</span>
                    </>
                  }
                  text="Fale com milhares de contatos pelo seu próprio WhatsApp, sem queimar o número."
                />
                <ul className="mt-10 space-y-4">
                  {CAMPAIGN_POINTS.map(({ icon: Icon, text }, index) => (
                    <Reveal key={text} delay={index * 70}>
                      <li className="flex items-start gap-3">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-background shadow-soft">
                          <Icon className="h-4 w-4" />
                        </span>
                        <span className="pt-1 text-[15px]">{text}</span>
                      </li>
                    </Reveal>
                  ))}
                </ul>
              </div>

              <div className="relative flex items-center justify-center bg-zinc-950 p-8 sm:p-14">
                <div className="bg-grid pointer-events-none absolute inset-0" />
                <Reveal delay={120} className="relative w-full max-w-sm">
                  <div className="rounded-2xl border border-white/10 bg-zinc-900 p-5 text-white shadow-float">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium">Black Friday · Clientes VIP</p>
                      <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 text-[11px] text-emerald-300">
                        Em andamento
                      </span>
                    </div>
                    <div className="mt-5 h-2 overflow-hidden rounded-full bg-white/10">
                      <div className="h-full w-[68%] rounded-full bg-white" />
                    </div>
                    <p className="mt-2 text-xs text-white/50">Lote 7 de 10 · próximo em 4 min</p>
                    <div className="mt-6 grid grid-cols-3 gap-2 text-center">
                      {[
                        ["1.360", "Enviados"],
                        ["1.298", "Confirmados"],
                        ["214", "Respostas"],
                      ].map(([value, label]) => (
                        <div key={label} className="rounded-xl bg-white/5 p-3">
                          <p className="text-lg font-semibold tabular-nums">{value}</p>
                          <p className="text-[11px] text-white/50">{label}</p>
                        </div>
                      ))}
                    </div>
                    <div className="mt-5 rounded-xl bg-[oklch(97%_0.01_95)] p-3 text-[13px] text-zinc-900">
                      <div className="ml-auto w-fit max-w-[90%] rounded-xl rounded-tr-sm bg-[oklch(93%_0.07_150)] px-3 py-1.5">
                        Oi, <b>{"{{1}}"}</b>! Separei <b>{"{{2}}"}</b> de desconto só pra você hoje 🖤
                      </div>
                    </div>
                  </div>
                </Reveal>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Team & reliability */}
      <section className="pb-28 sm:pb-36">
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          <SectionTitle
            eyebrow="Equipe e operação"
            title={
              <>
                Feito para times. <span className="font-display font-normal italic">Pronto para crescer.</span>
              </>
            }
          />
          <div className="mt-14 grid gap-4 lg:grid-cols-3">
            <Reveal className="lg:col-span-2">
              <div className="h-full rounded-2xl border p-7">
                <div className="flex items-center gap-3">
                  <Users className="h-5 w-5" />
                  <h3 className="text-lg font-semibold">Cargos e permissões por módulo</h3>
                </div>
                <p className="mt-2 text-muted-foreground">
                  Cada cargo tem acesso sem acesso, só ver ou ver e editar em cada área. Leads e reuniões podem ser
                  distribuídos automaticamente para quem estiver disponível.
                </p>
                <div className="mt-6 grid gap-2 sm:grid-cols-4">
                  {ROLES.map((role) => (
                    <div key={role.name} className="rounded-xl border bg-muted/40 p-4">
                      <p className="text-sm font-semibold">{role.name}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{role.text}</p>
                    </div>
                  ))}
                </div>
              </div>
            </Reveal>
            <Reveal delay={100}>
              <div className="h-full rounded-2xl bg-zinc-950 p-7 text-white">
                <RefreshCcw className="h-5 w-5" />
                <h3 className="mt-5 text-lg font-semibold">Vigia de conexão</h3>
                <p className="mt-2 text-sm leading-relaxed text-white/60">
                  O WhatsApp é monitorado o tempo todo e reconecta sozinho quando cai. Você é avisado na plataforma,
                  em tempo real.
                </p>
              </div>
            </Reveal>
            <Reveal>
              <div className="h-full rounded-2xl border p-7">
                <KeyRound className="h-5 w-5" />
                <h3 className="mt-5 text-lg font-semibold">Multi-empresa</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  Uma conta, várias empresas. Cada uma com seu número, agentes e equipe. Convide pessoas por código.
                </p>
              </div>
            </Reveal>
            <Reveal delay={100}>
              <div className="h-full rounded-2xl border p-7">
                <ShieldCheck className="h-5 w-5" />
                <h3 className="mt-5 text-lg font-semibold">Seus dados, separados</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  Conversas, leads e documentos isolados por empresa, com acesso só para quem você autorizar.
                </p>
              </div>
            </Reveal>
            <Reveal delay={200}>
              <div className="h-full rounded-2xl border p-7">
                <Gauge className="h-5 w-5" />
                <h3 className="mt-5 text-lg font-semibold">Custos sob controle</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  Veja quantos tokens cada agente usou por período e por função. Sem surpresas no fim do mês.
                </p>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="scroll-mt-16 border-t bg-muted/30 py-28 sm:py-36">
        <div className="mx-auto grid max-w-7xl gap-12 px-5 sm:px-8 lg:grid-cols-[0.8fr_1.2fr]">
          <SectionTitle
            eyebrow="Perguntas frequentes"
            title={
              <>
                Ficou <span className="font-display font-normal italic">alguma dúvida?</span>
              </>
            }
            text="As respostas mais comuns de quem está começando com o GetLeads."
          />
          <Reveal delay={100}>
            <div className="border-t">
              {FAQ.map((item) => (
                <FaqItem key={item.q} {...item} />
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* Final CTA */}
      <section className="relative overflow-hidden bg-zinc-950 py-32 text-center text-white sm:py-40">
        <div className="bg-grid pointer-events-none absolute inset-0" />
        <div className="pointer-events-none absolute left-1/2 top-full h-[36rem] w-[60rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/10 blur-[140px]" />
        <Reveal className="relative mx-auto max-w-3xl px-5">
          <img src={icon} alt="" className="mx-auto h-14 w-14 invert" />
          <h2 className="mt-10 text-5xl font-semibold leading-[1.02] sm:text-6xl">
            <span className="text-silver">Pare de perder lead</span>
            <br />
            <span className="font-display font-normal italic">no WhatsApp.</span>
          </h2>
          <p className="mx-auto mt-6 max-w-xl text-lg text-white/60">
            Conecte seu número, configure o agente e veja os leads chegando prontos no quadro.
          </p>
          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              to={primaryCta.to}
              className="group inline-flex h-12 items-center gap-2 rounded-full bg-white px-7 text-[15px] font-medium text-zinc-950 transition-transform hover:scale-[1.03]"
            >
              {primaryCta.label}
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            {!session && (
              <Link
                to="/login"
                className="inline-flex h-12 items-center rounded-full border border-white/15 px-7 text-[15px] text-white/80 hover:bg-white/5"
              >
                Já tenho conta
              </Link>
            )}
          </div>
        </Reveal>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/10 bg-zinc-950 text-white/50">
        <div className="mx-auto flex max-w-7xl flex-col gap-8 px-5 py-12 sm:px-8 md:flex-row md:items-center md:justify-between">
          <div>
            <img src={logo} alt="GetLeads" className="h-7 w-auto opacity-80 invert" />
            <p className="mt-3 text-sm">Potencializando leads para negócios.</p>
          </div>
          <nav className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            {NAV.map((item) => (
              <a key={item.href} href={item.href} className="hover:text-white">
                {item.label}
              </a>
            ))}
            <Link to="/login" className="hover:text-white">
              Entrar
            </Link>
          </nav>
          <p className="text-xs">© {new Date().getFullYear()} GetLeads</p>
        </div>
      </footer>
    </div>
  );
}
