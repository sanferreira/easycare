import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  Users,
  LogOut,
  Menu,
  Calendar,
  Clock3,
  Building2,
  ShieldAlert,
  UserCheck,
  FileText,
  DollarSign,
  KanbanSquare,
  SlidersHorizontal,
} from "lucide-react";
import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useEnvironmentSettings } from "@/hooks/use-environment-settings";
import { canAccessRoute, ROLE_LABELS } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { NotificationCenter } from "@/components/NotificationCenter";

const allNavItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/residents", label: "Pacientes", icon: Users },
  { href: "/prontuario", label: "Prontuário", icon: FileText },
  { href: "/staff", label: "Equipe", icon: UserCheck },
  { href: "/escalas", label: "Escalas", icon: Calendar },
  { href: "/ponto-eletronico", label: "Ponto", icon: Clock3 },
  { href: "/financeiro", label: "Financeiro", icon: DollarSign },
  { href: "/crm", label: "CRM", icon: KanbanSquare },
  { href: "/environment", label: "Ambiente", icon: SlidersHorizontal },
];

const superAdminItems = [
  { href: "/admin", label: "Organizacoes", icon: Building2 },
  { href: "/crm", label: "CRM", icon: KanbanSquare },
];

function NavContent({ onClose }: { onClose?: () => void }) {
  const [location] = useLocation();
  const { logout, user } = useAuth();
  const { data: environmentSettings } = useEnvironmentSettings({
    enabled: !!user && !user?.isSuperAdmin,
  });

  const isActive = (href: string) =>
    href === "/" ? location === "/" : location.startsWith(href);

  const navItems = user?.isSuperAdmin
    ? superAdminItems
    : allNavItems.filter((item) => canAccessRoute(user?.role, item.href, environmentSettings?.roleRoutes));

  const roleLabel = user?.role ? (ROLE_LABELS[user.role] ?? user.role) : "";

  return (
    <div
      className="flex flex-col h-full"
      style={{ background: "linear-gradient(180deg, #0D1535 0%, #0A0F2C 100%)" }}
    >
      <div className="px-5 pt-6 pb-5 border-b border-white/[0.07]">
        <div className="flex items-center gap-3">
          <img src="/easycare-logo.png" alt="EasyCare" className="h-9 w-9 object-contain rounded-xl" />
          <div>
            <p className="font-bold text-lg leading-none tracking-tight" style={{ fontFamily: "var(--font-display)" }}>
              <span className="text-white">Easy</span>
              <span style={{ color: "#22D3EE" }}>Care</span>
            </p>
            <p className="text-[10px] mt-0.5" style={{ color: "rgba(255,255,255,0.4)" }}>
              Gestão Inteligente
            </p>
          </div>
        </div>

        {user?.organizationName && (
          <div className="mt-3 flex items-center gap-2 px-2 py-1.5 rounded-lg" style={{ background: "rgba(31,111,235,0.15)" }}>
            <Building2 className="h-3 w-3 shrink-0" style={{ color: "#22D3EE" }} />
            <p className="text-xs font-medium truncate" style={{ color: "#22D3EE" }}>{user.organizationName}</p>
          </div>
        )}
        {user?.isSuperAdmin && (
          <div className="mt-3 flex items-center gap-2 px-2 py-1.5 rounded-lg" style={{ background: "rgba(251,191,36,0.12)" }}>
            <ShieldAlert className="h-3 w-3 shrink-0 text-amber-400" />
            <p className="text-xs font-medium text-amber-400">Super Administrador</p>
          </div>
        )}
      </div>

      <nav className="flex-1 px-4 py-4 space-y-1 overflow-y-auto">
        <p
          className="text-[10px] uppercase tracking-widest font-semibold px-2 pb-2"
          style={{ color: user?.isSuperAdmin ? "rgba(251,191,36,0.6)" : "rgba(255,255,255,0.3)" }}
        >
          {user?.isSuperAdmin ? "Administracao" : "Menu"}
        </p>

        {navItems.map((item) => {
          const active = isActive(item.href);
          return (
            <Link key={item.href} href={item.href} onClick={onClose}>
              <div
                className={`sidebar-nav-item ${active ? "active" : ""}`}
                data-testid={`nav-${item.label.toLowerCase()}`}
              >
                <item.icon className="h-4 w-4 shrink-0" />
                <span>{item.label}</span>
                {active && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-white/80" />}
              </div>
            </Link>
          );
        })}
      </nav>

      <div className="px-4 pb-5 pt-3 border-t border-white/[0.07] space-y-2">
        <div className="flex items-center gap-3 px-2 py-2">
          <div
            className="h-8 w-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
            style={{ background: "linear-gradient(135deg, #1F6FEB, #22D3EE)", color: "#fff" }}
          >
            {user?.isSuperAdmin
              ? <ShieldAlert className="h-4 w-4" />
              : (user?.name?.charAt(0)?.toUpperCase() ?? "U")}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold truncate text-white/90">{user?.name}</p>
            <p className="text-[11px] truncate" style={{ color: "rgba(255,255,255,0.4)" }}>
              {user?.isSuperAdmin ? "Super Admin" : roleLabel}
            </p>
          </div>
          <NotificationCenter />
        </div>
        <button
          onClick={() => {
            logout();
            onClose?.();
          }}
          className="w-full flex items-center gap-2.5 px-2 py-2 rounded-xl text-sm transition-colors"
          style={{ color: "rgba(255,255,255,0.45)" }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "#fff")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.45)")}
          data-testid="button-logout"
        >
          <LogOut className="h-4 w-4" />
          Sair
        </button>
      </div>
    </div>
  );
}

export function Sidebar() {
  const [open, setOpen] = useState(false);
  const { user } = useAuth();

  return (
    <>
      <aside className="hidden md:flex flex-col w-64 fixed inset-y-0 left-0 z-30 shadow-2xl">
        <NavContent />
      </aside>

      <Sheet open={open} onOpenChange={setOpen}>
        <div className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-border/70 bg-background/95 px-3 backdrop-blur md:hidden">
          <SheetTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-9 gap-2 border-[#0A0F2C]/15 bg-white text-[#0A0F2C] shadow-sm hover:bg-[#F1F5F9]"
            >
              <Menu className="h-4 w-4" />
              Menu
            </Button>
          </SheetTrigger>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">
              {user?.organizationName ?? "EasyCare"}
            </p>
            <p className="text-[11px] text-muted-foreground">Gestão Inteligente</p>
          </div>
          <div className="ml-auto">
            <NotificationCenter surface="light" />
          </div>
        </div>
        <SheetContent side="left" className="p-0 w-64 border-0">
          <NavContent onClose={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
    </>
  );
}
