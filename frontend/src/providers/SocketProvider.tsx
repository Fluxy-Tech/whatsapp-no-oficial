import { createContext, useContext, useEffect } from "react";
import { socket } from "@/lib/socket";
import { authClient } from "@/lib/auth-client";

const SocketContext = createContext(socket);

export function useSocket() {
  return useContext(SocketContext);
}

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const { data: activeOrganization } = authClient.useActiveOrganization();
  const organizationId = activeOrganization?.id ?? null;

  useEffect(() => {
    if (!socket.connected) socket.connect();
    return () => {
      socket.disconnect();
    };
  }, []);

  // The server forgets the room on every reconnect (backend restart, network
  // drop), so join again on each "connect", not only once.
  useEffect(() => {
    if (!organizationId) return;
    const join = () => socket.emit("join-organization", organizationId);
    if (socket.connected) join();
    socket.on("connect", join);
    return () => {
      socket.off("connect", join);
    };
  }, [organizationId]);

  return <SocketContext.Provider value={socket}>{children}</SocketContext.Provider>;
}
