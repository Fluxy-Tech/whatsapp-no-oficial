import { useEffect, useState } from "react";
import { FileText } from "lucide-react";
import { api } from "@/lib/api";
import { Spinner } from "@/components/ui/spinner";

type ChatMessageMediaProps = {
  chatId: string;
  wppId: string;
  type: string;
  filename?: string | null;
};

const AUTO_FETCH_TYPES = new Set(["image", "sticker", "audio", "ptt"]);

export function ChatMessageMedia({ chatId, wppId, type, filename }: ChatMessageMediaProps) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  function fetchMedia() {
    setLoading(true);
    setError(false);
    return api<{ dataUrl: string }>(
      `/api/messages/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(wppId)}/media`,
    )
      .then((res) => {
        setDataUrl(res.dataUrl);
        return res.dataUrl;
      })
      .catch(() => {
        setError(true);
        return null;
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    setDataUrl(null);
    setError(false);
    if (AUTO_FETCH_TYPES.has(type)) fetchMedia();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wppId, type]);

  async function handleDownload() {
    const url = dataUrl ?? (await fetchMedia());
    if (!url) return;

    const link = document.createElement("a");
    link.href = url;
    link.download = filename ?? "documento";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  if (type === "image" || type === "sticker") {
    if (loading) {
      return (
        <div className="flex h-40 w-40 items-center justify-center rounded-md bg-black/5">
          <Spinner className="size-5 text-muted-foreground" />
        </div>
      );
    }
    if (error || !dataUrl) {
      return <p className="text-xs italic text-muted-foreground">Não foi possível carregar a imagem.</p>;
    }
    return <img src={dataUrl} alt="" className="max-h-64 max-w-full rounded-md object-contain" />;
  }

  if (type === "audio" || type === "ptt") {
    if (loading) return <Spinner className="size-5 text-muted-foreground" />;
    if (error || !dataUrl) {
      return <p className="text-xs italic text-muted-foreground">Não foi possível carregar o áudio.</p>;
    }
    return (
      // eslint-disable-next-line jsx-a11y/media-has-caption
      <audio controls src={dataUrl} className="max-w-full" />
    );
  }

  if (type === "document") {
    return (
      <button
        type="button"
        onClick={handleDownload}
        disabled={loading}
        className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm hover:bg-accent disabled:opacity-60"
      >
        {loading ? <Spinner className="size-4" /> : <FileText className="size-4" />}
        <span className="max-w-48 truncate">{filename ?? "Documento"}</span>
      </button>
    );
  }

  return <p className="text-xs italic text-muted-foreground">Mensagem não suportada ({type}).</p>;
}
