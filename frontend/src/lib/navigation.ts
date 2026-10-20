import {
  Bot,
  CalendarDays,
  KanbanSquare,
  LayoutDashboard,
  Megaphone,
  MessageSquare,
  Settings,
  Target,
  type LucideIcon,
} from "lucide-react";
import type { Module } from "@/lib/organization";

export type NavLink = {
  label: string;
  href: string;
  icon: LucideIcon;
  module: Module;
  /** Other paths that belong to this page (e.g. /dashboard/lead/:id is a lead page). */
  match?: string[];
  /** One line for the command palette. */
  hint: string;
  /** Single key used with "G" (G then C opens Conversas). */
  shortcut?: string;
};

export type NavSection = { label: string; links: NavLink[] };

// Sidebar, topbar breadcrumb and command palette read the same list.
export const NAV_SECTIONS: NavSection[] = [
  {
    label: "Visão geral",
    links: [
      {
        label: "Dashboard",
        href: "/dashboard/painel",
        icon: LayoutDashboard,
        module: "dashboard",
        hint: "Conexão, leads e interações do ano",
        shortcut: "D",
      },
    ],
  },
  {
    label: "Relacionamento",
    links: [
      {
        label: "Conversas",
        href: "/dashboard/conversas",
        icon: MessageSquare,
        module: "conversas",
        hint: "Chat do WhatsApp em tempo real",
        shortcut: "C",
      },
      {
        label: "Quadro",
        href: "/dashboard/quadro",
        icon: KanbanSquare,
        module: "crm",
        hint: "Esteiras e colunas do CRM",
        shortcut: "Q",
      },
      {
        label: "Calendário",
        href: "/dashboard/calendario",
        icon: CalendarDays,
        module: "crm",
        hint: "Reuniões manuais e agendadas pela IA",
        shortcut: "K",
      },
      {
        label: "Leads",
        href: "/dashboard/leads",
        icon: Target,
        module: "leads",
        match: ["/dashboard/lead/"],
        hint: "Contatos e metadados coletados",
        shortcut: "L",
      },
    ],
  },
  {
    label: "Automação",
    links: [
      {
        label: "Campanhas",
        href: "/dashboard/campanhas",
        icon: Megaphone,
        module: "campanhas",
        match: ["/dashboard/campanhas/"],
        hint: "Disparos em massa por CSV ou manual",
        shortcut: "P",
      },
      {
        label: "Agentes de IA",
        href: "/dashboard/agentes",
        icon: Bot,
        module: "agentes",
        match: ["/dashboard/agentes/"],
        hint: "Prompt, documentos, RGBS e funções",
        shortcut: "A",
      },
    ],
  },
  {
    label: "Sistema",
    links: [
      {
        label: "Configurações",
        href: "/dashboard/configuracoes",
        icon: Settings,
        module: "configuracoes",
        hint: "WhatsApp, equipe e permissões",
        shortcut: "S",
      },
    ],
  },
];

export const NAV_LINKS = NAV_SECTIONS.flatMap((section) => section.links);

export function isLinkActive(link: NavLink, pathname: string) {
  return pathname === link.href || (link.match ?? []).some((prefix) => pathname.startsWith(prefix));
}

export function findSection(pathname: string) {
  for (const section of NAV_SECTIONS) {
    const link = section.links.find((candidate) => isLinkActive(candidate, pathname));
    if (link) return { section, link };
  }
  return null;
}
