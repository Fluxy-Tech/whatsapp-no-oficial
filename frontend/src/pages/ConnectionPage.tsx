import { authClient } from "@/lib/auth-client";
import { WhatsappConnectionCard } from "@/components/WhatsappConnectionCard";

export function ConnectionPage() {
  const { data: activeMember } = authClient.useActiveMember();
  const role = activeMember?.role;
  const canConnectWhatsapp = role === "owner" || role === "admin";

  return <WhatsappConnectionCard canConnect={canConnectWhatsapp} />;
}
