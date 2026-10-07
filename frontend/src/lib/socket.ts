import { io } from "socket.io-client";

export const socket = io(import.meta.env.VITE_API_URL ?? "http://localhost:6802", {
  withCredentials: true,
  autoConnect: false,
});
