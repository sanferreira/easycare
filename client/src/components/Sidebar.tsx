import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  Users,
  LogOut,
  Menu,
  Calendar,
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

const allNavItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/residents", label: "Residentes", icon: Users },
  { href: "/prontuario", label: "Prontuario", icon: FileText },
  { href: "/staff", label: "Equipe", icon: UserCheck },
  { href: "/escalas", label: "Escalas", icon: Calendar },
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
              Gestao Inteligente
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

  return (
    <>
      <aside className="hidden md:flex flex-col w-64 fixed inset-y-0 left-0 z-30 shadow-2xl">
        <NavContent />
      </aside>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden fixed top-3 left-3 z-40 bg-[#0A0F2C] text-white hover:bg-[#1F6FEB] border border-white/10 shadow-lg"
          >
            <Menu className="h-5 w-5" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="p-0 w-64 border-0">
          <NavContent onClose={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
    </>
  );
}
