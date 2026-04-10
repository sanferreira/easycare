import { Switch, Route, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Sidebar } from "@/components/Sidebar";
import { useAuth } from "@/hooks/use-auth";
import { useEnvironmentSettings } from "@/hooks/use-environment-settings";
import { canAccessRoute } from "@/lib/permissions";

// Pages
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import Residents from "@/pages/Residents";
import Staff from "@/pages/Staff";
import Escalas from "@/pages/Escalas";
import Admin from "@/pages/Admin";
import Prontuario from "@/pages/Prontuario";
import Financeiro from "@/pages/Financeiro";
import Crm from "@/pages/Crm";
import EnvironmentSettings from "@/pages/EnvironmentSettings";
import FamilyPortalLogin from "@/pages/FamilyPortalLogin";
import FamilyPortalHome from "@/pages/FamilyPortalHome";
import NotFound from "@/pages/not-found";

function AccessDenied() {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-4">
      <div className="h-16 w-16 rounded-2xl flex items-center justify-center mb-4"
        style={{ background: "rgba(239,68,68,0.1)" }}>
        <svg className="h-8 w-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
        </svg>
      </div>
      <h2 className="text-xl font-bold text-foreground mb-1">Acesso não autorizado</h2>
      <p className="text-muted-foreground text-sm">Seu perfil não tem permissão para acessar esta página.</p>
    </div>
  );
}

interface PrivateRouteProps {
  component: React.ComponentType;
  superAdminOnly?: boolean;
  allowSuperAdmin?: boolean;
  route?: string;
}

function PrivateRoute({ component: Component, superAdminOnly = false, allowSuperAdmin = false, route }: PrivateRouteProps) {
  const { user, isLoading } = useAuth();
  const { data: environmentSettings, isLoading: isEnvironmentSettingsLoading } = useEnvironmentSettings({
    enabled: !!user && !user?.isSuperAdmin,
  });

  if (isLoading) return (
    <div className="min-h-screen flex items-center justify-center text-muted-foreground">
      Carregando...
    </div>
  );
  if (!user) return <Redirect to="/login" />;
  if (!user.isSuperAdmin && !superAdminOnly && isEnvironmentSettingsLoading) return (
    <div className="min-h-screen flex items-center justify-center text-muted-foreground">
      Carregando...
    </div>
  );

  // Super admin só acessa a área admin, exceto módulos explicitamente permitidos
  if (user.isSuperAdmin && !superAdminOnly && !allowSuperAdmin) return <Redirect to="/admin" />;
  if (superAdminOnly && !user.isSuperAdmin) return <Redirect to="/" />;

  // Verificação de permissão por papel
  if (!user.isSuperAdmin && !superAdminOnly && route && !canAccessRoute(user.role, route, environmentSettings?.roleRoutes)) {
    return (
      <div className="min-h-screen bg-background flex">
        <Sidebar />
        <main className="flex-1 md:pl-64">
          <div className="p-3 sm:p-4 lg:p-6 h-full overflow-y-auto">
            <AccessDenied />
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex">
      <Sidebar />
      <main className="flex-1 md:pl-64">
        <div className="p-3 sm:p-4 lg:p-6 h-full overflow-y-auto">
          <Component />
        </div>
      </main>
    </div>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />

      <Route path="/">
        <PrivateRoute component={Dashboard} route="/" />
      </Route>
      <Route path="/residents">
        <PrivateRoute component={Residents} route="/residents" />
      </Route>
      <Route path="/medications">
        <Redirect to="/residents" />
      </Route>
      <Route path="/staff">
        <PrivateRoute component={Staff} route="/staff" />
      </Route>
      <Route path="/escalas">
        <PrivateRoute component={Escalas} route="/escalas" />
      </Route>
      <Route path="/occurrences">
        <Redirect to="/residents" />
      </Route>
      <Route path="/prontuario">
        <PrivateRoute component={Prontuario} route="/prontuario" />
      </Route>
      <Route path="/financeiro">
        <PrivateRoute component={Financeiro} route="/financeiro" />
      </Route>
      <Route path="/crm">
        <PrivateRoute component={Crm} route="/crm" allowSuperAdmin />
      </Route>
      <Route path="/environment">
        <PrivateRoute component={EnvironmentSettings} route="/environment" />
      </Route>
      <Route path="/admin">
        <PrivateRoute component={Admin} superAdminOnly />
      </Route>

      {/* Family Portal — public routes */}
      <Route path="/portal" component={FamilyPortalLogin} />
      <Route path="/portal/home" component={FamilyPortalHome} />

      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
