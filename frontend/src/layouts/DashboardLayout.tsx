import { useEffect, useRef, useState } from "react";
import { Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { authClient } from "@/lib/auth-client";
import { NAV_LINKS } from "@/lib/navigation";
import { HandoffProvider } from "@/providers/HandoffProvider";
import { OrganizationProvider, useOrganization } from "@/providers/OrganizationProvider";
import { AppSidebar } from "@/components/AppSidebar";
import { CommandPalette } from "@/components/shell/CommandPalette";
import { Topbar } from "@/components/shell/Topbar";
import { Spinner } from "@/components/ui/spinner";

const COLLAPSED_KEY = "getleads:sidebar-collapsed";

function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

function Shell() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { current } = useOrganization();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const pendingG = useRef<number | null>(null);

  function toggleCollapsed() {
    setCollapsed((value) => {
      try {
        localStorage.setItem(COLLAPSED_KEY, value ? "0" : "1");
      } catch {
        // Private mode: the choice just isn't remembered.
      }
      return !value;
    });
  }

  useEffect(() => setMobileOpen(false), [pathname]);

  // ⌘K / Ctrl+K opens the search; "G" then a letter jumps to an area (Linear style).
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen((open) => !open);
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target) || searchOpen) return;

      const key = event.key.toUpperCase();
      if (pendingG.current !== null) {
        window.clearTimeout(pendingG.current);
        pendingG.current = null;
        const link = NAV_LINKS.find(
          (candidate) => candidate.shortcut === key && current && current.permissions[candidate.module] !== "none",
        );
        if (link) {
          event.preventDefault();
          navigate(link.href);
        }
        return;
      }
      if (key === "G") pendingG.current = window.setTimeout(() => (pendingG.current = null), 900);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [current, navigate, searchOpen]);

  return (
    <div className="flex h-dvh overflow-hidden bg-muted/40">
      <div className="hidden lg:flex">
        <AppSidebar collapsed={collapsed} onToggleCollapsed={toggleCollapsed} />
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Fechar menu"
            className="absolute inset-0 animate-overlay-in bg-zinc-950/40 backdrop-blur-[3px]"
            onClick={() => setMobileOpen(false)}
          />
          <div className="relative h-full w-fit animate-[slide-in_260ms_cubic-bezier(0.16,1,0.3,1)] shadow-float">
            <AppSidebar onNavigate={() => setMobileOpen(false)} />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onOpenMenu={() => setMobileOpen(true)} onOpenSearch={() => setSearchOpen(true)} />
        {/* Only <main> scrolls. "relative" keeps absolutely positioned elements (e.g. the hidden native
            <select> Radix renders inside forms) inside it; otherwise they stretch the page and the sidebar scrolls away. */}
        <main key={pathname} className="relative min-h-0 w-full flex-1 animate-[page-in_320ms_ease-out] space-y-6 overflow-y-auto p-4 sm:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>

      <CommandPalette open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  );
}

export function DashboardLayout() {
  const { data: activeOrganization, isPending } = authClient.useActiveOrganization();

  if (isPending) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner className="size-6 text-muted-foreground" />
      </div>
    );
  }

  // Every login starts without a company: the user picks one first.
  if (!activeOrganization) return <Navigate to="/organizacoes" replace />;

  return (
    <OrganizationProvider>
      <HandoffProvider>
        <Shell />
      </HandoffProvider>
    </OrganizationProvider>
  );
}
