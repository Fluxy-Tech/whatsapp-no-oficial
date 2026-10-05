import { Navigate, Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { SocketProvider } from "@/providers/SocketProvider";
import { DashboardLayout } from "@/layouts/DashboardLayout";
import { LoginPage } from "@/pages/LoginPage";
import { RegisterPage } from "@/pages/RegisterPage";
import { ConnectionPage } from "@/pages/ConnectionPage";
import { ConversationsPage } from "@/pages/ConversationsPage";
import { TargetsPage } from "@/pages/TargetsPage";
import { AgentsPage } from "@/pages/AgentsPage";

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
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
        <Route index element={<Navigate to="conversas" replace />} />
        <Route path="conexao" element={<ConnectionPage />} />
        <Route path="conversas" element={<ConversationsPage />} />
        <Route path="targets" element={<TargetsPage />} />
        <Route path="agentes" element={<AgentsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
