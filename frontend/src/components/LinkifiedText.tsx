import type { ReactNode } from "react";
import { ExternalLink, ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const URL_PATTERN = /https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/g;

/** Links of approved images (JEV image metadados) go through the backend's media/open redirect. */
const isImageLink = (url: string) => /\/media\/open(?:$|[?#])/.test(url);

export function extractLinks(text: string) {
  return [...new Set(text.match(URL_PATTERN) ?? [])];
}

function LinkAnchor({ url }: { url: string }) {
  const image = isImageLink(url);
  const Icon = image ? ImageIcon : ExternalLink;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex max-w-full items-center gap-1 align-bottom font-medium text-primary underline-offset-4 hover:underline"
      title={url}
      onClick={(event) => event.stopPropagation()}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{image ? "Abrir imagem" : url}</span>
    </a>
  );
}

/** Text with its URLs turned into links (image links read "Abrir imagem"). */
export function LinkifiedText({ text, className }: { text: string; className?: string }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0;
    if (start > last) parts.push(text.slice(last, start));
    parts.push(<LinkAnchor key={start} url={match[0]} />);
    last = start + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <span className={cn("break-words", className)}>{parts}</span>;
}

/** Only the links of a text, one per line (e.g. under an editable field). */
export function TextLinks({ text, className }: { text: string; className?: string }) {
  const links = extractLinks(text);
  if (!links.length) return null;
  return (
    <div className={cn("flex min-w-0 flex-col gap-1 text-xs", className)}>
      {links.map((url) => (
        <LinkAnchor key={url} url={url} />
      ))}
    </div>
  );
}
