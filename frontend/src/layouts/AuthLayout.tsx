import type { ReactNode } from "react";
import capa from "@/assets/capa.jpg";
import logo from "@/assets/getleads-logo.png";

// Split screen for login/register: form on the left, cover image on the right.
// The image is hidden on small screens so the form takes the full width.
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <div className="flex w-full flex-col items-center justify-center gap-8 bg-muted/30 px-4 py-10 lg:w-1/2">
        <img src={logo} alt="GetLeads" className="h-14 w-auto" />
        {children}
      </div>
      <div className="hidden lg:block lg:w-1/2">
        <img src={capa} alt="" className="h-screen w-full object-cover" />
      </div>
    </div>
  );
}
