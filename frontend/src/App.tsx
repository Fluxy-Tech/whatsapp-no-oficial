import { Navigate, Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { ModuleGuard, ModuleHome } from "@/components/ModuleGuard";
import { SocketProvider } from "@/providers/SocketProvider";
import { DashboardLayout } from "@/layouts/DashboardLayout";
import { LoginPage } from "@/pages/LoginPage";
import { RegisterPage } from "@/pages/RegisterPage";
import { OrganizationSelectPage } from "@/pages/OrganizationSelectPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { BoardPage } from "@/pages/BoardPage";
import { CalendarPage } from "@/pages/CalendarPage";
import { LeadDetailPage } from "@/pages/LeadDetailPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { ProfilePage } from "@/pages/ProfilePage";
import { ConversationsPage } from "@/pages/ConversationsPage";
import { LeadsPage } from "@/pages/LeadsPage";
import { AgentsPage } from "@/pages/AgentsPage";
import { AgentDetailPage } from "@/pages/AgentDetailPage";
import { CampaignsPage } from "@/pages/CampaignsPage";
import { CampaignDetailPage } from "@/pages/CampaignDetailPage";

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route
        path="/organizacoes"
        element={
          <ProtectedRoute>
            <OrganizationSelectPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <SocketProvider>
              <DashboardLayout />
            </SocketProvider>
          </ProtectedRoute>
        }
      >
        <Route index element={<ModuleHome />} />
        <Route path="painel" element={<ModuleGuard module="dashboard"><DashboardPage /></ModuleGuard>} />
        <Route path="conversas" element={<ModuleGuard module="conversas"><ConversationsPage /></ModuleGuard>} />
        <Route path="quadro" element={<ModuleGuard module="crm"><BoardPage /></ModuleGuard>} />
        <Route path="calendario" element={<ModuleGuard module="crm"><CalendarPage /></ModuleGuard>} />
        <Route path="leads" element={<ModuleGuard module="leads"><LeadsPage /></ModuleGuard>} />
        <Route path="lead/:id" element={<ModuleGuard module="leads"><LeadDetailPage /></ModuleGuard>} />
        <Route path="campanhas" element={<ModuleGuard module="campanhas"><CampaignsPage /></ModuleGuard>} />
        <Route path="campanhas/:id" element={<ModuleGuard module="campanhas"><CampaignDetailPage /></ModuleGuard>} />
        <Route path="agentes" element={<ModuleGuard module="agentes"><AgentsPage /></ModuleGuard>} />
        <Route path="agentes/:id" element={<ModuleGuard module="agentes"><AgentDetailPage /></ModuleGuard>} />
        <Route path="configuracoes" element={<ModuleGuard module="configuracoes"><SettingsPage /></ModuleGuard>} />
        {/* Every member can edit their own profile. */}
        <Route path="perfil" element={<ProfilePage />} />
        <Route path="conexao" element={<Navigate to="/dashboard/configuracoes" replace />} />
        <Route path="targets" element={<Navigate to="/dashboard/leads" replace />} />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
