/** The contact asked to talk to a person: the agent was paused and OpenAI wrote a report of the conversation. */
export type HumanHandoff = {
  id: string;
  chatId: string;
  targetId: string;
  /** Why the agent handed over, in its own words. */
  reason: string;
  summaryStatus: "pending" | "ready" | "failed";
  summary: string | null;
  keyPoints: string[];
  summaryError: string | null;
  /** An attendant opened the conversation. */
  acknowledgedAt: string | null;
  createdAt: string;
};

/** Contact as sent in the socket events (backend targetView). */
export type SocketContact = {
  chatId: string;
  number: string | null;
  name: string | null;
  agentActive: boolean;
};

const sounds = new Map<string, HTMLAudioElement>();

/** Sounds in /public. Browsers only play after the user has interacted with the page. */
export function playSound(file: "novaMensagem.mp3" | "clienteSolicitouAtendimento.mp3") {
  try {
    let audio = sounds.get(file);
    if (!audio) {
      audio = new Audio(`${import.meta.env.BASE_URL}${file}`);
      sounds.set(file, audio);
    }
    audio.currentTime = 0;
    void audio.play().catch(() => {});
  } catch {
    // No audio support: the badges still show.
  }
}
