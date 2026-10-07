import { useState } from "react";
import { API_URL } from "@/lib/api";
import { initials } from "@/lib/dashboard";
import { cn } from "@/lib/utils";

const COLORS = ["bg-neutral-800", "bg-sky-500", "bg-amber-500", "bg-emerald-500", "bg-rose-500", "bg-slate-500"];

function colorOf(seed: string) {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return COLORS[Math.abs(hash) % COLORS.length];
}

/** user.image is a backend path ("/api/profile/users/:id/avatar?v=...") or an absolute URL. */
export function avatarSrc(image: string | null | undefined) {
  if (!image) return null;
  return image.startsWith("/api/") ? `${API_URL}${image}` : image;
}

/** Round avatar: the profile photo when there is one, otherwise the initials. */
export function MemberAvatar({
  id,
  name,
  image,
  className,
}: {
  id: string;
  name: string | null | undefined;
  image?: string | null;
  className?: string;
}) {
  const [broken, setBroken] = useState<string | null>(null);
  const src = avatarSrc(image);

  if (src && broken !== src) {
    return (
      <img
        src={src}
        alt={name ?? ""}
        title={name ?? undefined}
        onError={() => setBroken(src)}
        className={cn("h-7 w-7 shrink-0 rounded-full object-cover ring-2 ring-background", className)}
      />
    );
  }

  return (
    <span
      title={name ?? undefined}
      className={cn(
        "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white ring-2 ring-background",
        colorOf(id),
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}
