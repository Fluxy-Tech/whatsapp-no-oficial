import { createContext, useContext, useEffect, useRef } from "react";
import { socket } from "@/lib/socket";
import { authClient } from "@/lib/auth-client";

const SocketContext = createContext(socket);

export function useSocket() {
  return useContext(SocketContext);
}

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const { data: activeOrganization } = authClient.useActiveOrganization();
  const joinedOrgId = useRef<string | null>(null);

  useEffect(() => {
    if (!socket.connected) socket.connect();
    return () => {
      socket.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!activeOrganization || joinedOrgId.current === activeOrganization.id) return;
    joinedOrgId.current = activeOrganization.id;
    socket.emit("join-organization", activeOrganization.id);
  }, [activeOrganization]);

  return <SocketContext.Provider value={socket}>{children}</SocketContext.Provider>;
}
