import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Download, FileText, Paperclip, Send, Trash2 } from "lucide-react";
import { API_URL, api } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { timeAgo } from "@/lib/dashboard";
import { useOrganization } from "@/providers/OrganizationProvider";
import { MemberAvatar } from "@/components/dashboard/MemberAvatar";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";

type Person = { id: string; name: string; image?: string | null } | null;

type LeadComment = { id: string; body: string; author: Person; createdAt: string };
type LeadAttachment = {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  uploadedBy: Person;
  createdAt: string;
};

const MAX_FILE_BYTES = 20 * 1024 * 1024;

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Comments and attached files of a lead (board card drawer). */
export function LeadNotes({ leadId, canEdit }: { leadId: string; canEdit: boolean }) {
  const { data: session } = authClient.useSession();
  const { current } = useOrganization();
  const [comments, setComments] = useState<LeadComment[]>([]);
  const [attachments, setAttachments] = useState<LeadAttachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const base = `/api/dashboard/leads/${encodeURIComponent(leadId)}`;
  const canRemove = (person: Person) => canEdit && (person?.id === session?.user.id || Boolean(current?.canManage));

  const load = useCallback(async () => {
    try {
      const notes = await api<{ comments: LeadComment[]; attachments: LeadAttachment[] }>(`${base}/notes`);
      setComments(notes.comments);
      setAttachments(notes.attachments);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [base]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  async function run(action: () => Promise<void>) {
    setError(null);
    try {
      await action();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function sendComment(event: FormEvent) {
    event.preventDefault();
    if (!draft.trim()) return;
    setSending(true);
    await run(async () => {
      const created = await api<LeadComment>(`${base}/comments`, {
        method: "POST",
        body: JSON.stringify({ body: draft }),
      });
      setComments((list) => [...list, created]);
      setDraft("");
    });
    setSending(false);
  }

  async function removeComment(comment: LeadComment) {
    if (!confirm("Apagar este comentário?")) return;
    await run(async () => {
      await api(`${base}/comments/${comment.id}`, { method: "DELETE" });
      setComments((list) => list.filter((c) => c.id !== comment.id));
    });
  }

  async function upload(file: File) {
    if (file.size > MAX_FILE_BYTES) {
      setError("Arquivo muito grande (máx. 20MB).");
      return;
    }
    setUploading(true);
    await run(async () => {
      const body = new FormData();
      body.append("file", file);
      const created = await api<LeadAttachment>(`${base}/attachments`, { method: "POST", body });
      setAttachments((list) => [created, ...list]);
    });
    setUploading(false);
  }

  // The bucket is private: the file comes through the backend with the session cookie.
  async function download(attachment: LeadAttachment) {
    await run(async () => {
      const response = await fetch(`${API_URL}${base}/attachments/${attachment.id}/download`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Não foi possível baixar o arquivo");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = attachment.fileName;
      link.click();
      URL.revokeObjectURL(url);
    });
  }

  async function removeAttachment(attachment: LeadAttachment) {
    if (!confirm(`Apagar o arquivo "${attachment.fileName}"?`)) return;
    await run(async () => {
      await api(`${base}/attachments/${attachment.id}`, { method: "DELETE" });
      setAttachments((list) => list.filter((a) => a.id !== attachment.id));
    });
  }

  if (loading) {
    return (
      <div className="flex justify-center py-4">
        <Spinner className="size-5 text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {error && <p className="text-sm text-destructive">{error}</p>}

      {/* Attachments */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">Anexos</p>
          {canEdit && (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8"
                disabled={uploading}
                onClick={() => fileInput.current?.click()}
              >
                {uploading ? <Spinner className="size-3.5" /> : <Paperclip className="h-3.5 w-3.5" />}
                {uploading ? "Enviando..." : "Anexar arquivo"}
              </Button>
              <input
                ref={fileInput}
                type="file"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void upload(file);
                }}
              />
            </>
          )}
        </div>
        {attachments.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum arquivo anexado.</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {attachments.map((attachment) => (
              <li key={attachment.id} className="flex items-center gap-3 px-3 py-2">
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{attachment.fileName}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatSize(attachment.size)} · {attachment.uploadedBy?.name ?? "Usuário removido"} ·{" "}
                    {timeAgo(attachment.createdAt)}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => void download(attachment)}
                  aria-label={`Baixar ${attachment.fileName}`}
                  title="Baixar"
                >
                  <Download className="h-4 w-4" />
                </Button>
                {canRemove(attachment.uploadedBy) && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive"
                    onClick={() => void removeAttachment(attachment)}
                    aria-label={`Apagar ${attachment.fileName}`}
                    title="Apagar"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Comments */}
      <div className="space-y-2">
        <p className="text-sm font-medium">Comentários</p>
        {comments.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum comentário ainda.</p>
        ) : (
          <ul className="space-y-3">
            {comments.map((comment) => (
              <li key={comment.id} className="flex gap-2">
                <MemberAvatar
                  id={comment.author?.id ?? "removed"}
                  name={comment.author?.name ?? "?"}
                  image={comment.author?.image}
                />
                <div className="min-w-0 flex-1 rounded-md bg-muted/60 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-xs font-semibold">{comment.author?.name ?? "Usuário removido"}</p>
                    <div className="flex shrink-0 items-center gap-1">
                      <span className="text-[11px] text-muted-foreground">{timeAgo(comment.createdAt)}</span>
                      {canRemove(comment.author) && (
                        <button
                          type="button"
                          onClick={() => void removeComment(comment)}
                          className="rounded p-0.5 text-muted-foreground hover:text-destructive"
                          aria-label="Apagar comentário"
                          title="Apagar"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm">{comment.body}</p>
                </div>
              </li>
            ))}
          </ul>
        )}

        {canEdit && (
          <form onSubmit={sendComment} className="space-y-2">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(event) => {
                // Ctrl/Cmd + Enter sends.
                if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) void sendComment(event);
              }}
              placeholder="Escreva um comentário..."
              className="min-h-20"
              disabled={sending}
            />
            <div className="flex justify-end">
              <Button type="submit" size="sm" disabled={sending || !draft.trim()}>
                <Send className="h-3.5 w-3.5" />
                {sending ? "Enviando..." : "Comentar"}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
