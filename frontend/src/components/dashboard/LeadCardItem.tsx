import type { DragEvent } from "react";
import { Clock, Eye, MessageSquare, MessageSquareText, MoreHorizontal, Paperclip, Trash2 } from "lucide-react";
import {
  formatPhone,
  leadName,
  meetingStatus,
  meetingWhen,
  timeAgo,
  type LeadCard,
} from "@/lib/dashboard";
import { cn } from "@/lib/utils";
import { MemberAvatar } from "@/components/dashboard/MemberAvatar";
import { AttentionDot } from "@/components/ui/attention-dot";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type LeadCardItemProps = {
  card: LeadCard;
  canEdit: boolean;
  dragging: boolean;
  onOpen: () => void;
  onOpenChat: () => void;
  onRemove: () => void;
  onDragStart: (event: DragEvent) => void;
  onDragEnd: () => void;
  onDrop: (event: DragEvent) => void;
};

/** Lead card of the board: channel, name, phone, last message time and responsible. */
export function LeadCardItem({
  card,
  canEdit,
  dragging,
  onOpen,
  onOpenChat,
  onRemove,
  onDragStart,
  onDragEnd,
  onDrop,
}: LeadCardItemProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      draggable={canEdit}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter") onOpen();
      }}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={(event) => canEdit && event.preventDefault()}
      onDrop={onDrop}
      className={cn(
        "rounded-lg border bg-background p-4 shadow-xs transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        canEdit && "active:cursor-grabbing",
        dragging && "opacity-50",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <p className="truncate text-sm font-semibold">{leadName(card.lead)}</p>
          {/* Upcoming meeting: blinking dot in the primary color (details in the drawer). */}
          {card.meeting && meetingStatus(card.meeting) === "upcoming" && (
            <AttentionDot tone="primary" label={`Agenda vai acontecer em ${meetingWhen(card.meeting.startsAt)}`} />
          )}
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              onClick={(event) => event.stopPropagation()}
              className="-mr-1 -mt-1 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label="Ações do lead"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}>
            <DropdownMenuItem onSelect={onOpen}>
              <Eye />
              Ver detalhes
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onOpenChat}>
              <MessageSquare />
              Abrir conversa
            </DropdownMenuItem>
            {canEdit && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={onRemove}>
                  <Trash2 />
                  Apagar
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <p className="truncate text-xs text-muted-foreground">{formatPhone(card.lead.number) || card.lead.chatId}</p>

      <div className="mt-4 flex items-center justify-between gap-2 border-t pt-3">
        <span className="flex min-w-0 items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" />
            {timeAgo(card.lead.lastMessageAt)}
          </span>
          {card.commentsCount > 0 && (
            <span className="flex items-center gap-1" title={`${card.commentsCount} comentário(s)`}>
              <MessageSquareText className="h-3.5 w-3.5" />
              {card.commentsCount}
            </span>
          )}
          {card.attachmentsCount > 0 && (
            <span className="flex items-center gap-1" title={`${card.attachmentsCount} anexo(s)`}>
              <Paperclip className="h-3.5 w-3.5" />
              {card.attachmentsCount}
            </span>
          )}
        </span>
        {card.assignee ? (
          <MemberAvatar id={card.assignee.id} name={card.assignee.name} image={card.assignee.image} />
        ) : (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <AttentionDot />
            Sem responsável
          </span>
        )}
      </div>
    </div>
  );
}
