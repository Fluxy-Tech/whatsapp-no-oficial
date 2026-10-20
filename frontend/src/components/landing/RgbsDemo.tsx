import { useEffect, useRef, useState } from "react";
import { CheckCheck } from "lucide-react";
import { cn } from "@/lib/utils";

// Same answer twice: one block without RGBS, short paced messages with it.
const ANSWER =
  "Oi, Maria! Tudo bem? Consigo te ajudar com isso, sim. Temos horário amanhã às 14h ou às 16h. Qual o melhor pra você?";
const PARTS = [
  "Oi, Maria! Tudo bem? 😊",
  "Consigo te ajudar com isso, sim.",
  "Temos horário amanhã às 14h ou às 16h.",
  "Qual o melhor pra você?",
];

function Bubble({ text, visible }: { text: string; visible: boolean }) {
  return (
    <div
      className={cn(
        "ml-auto w-fit max-w-[88%] rounded-xl rounded-tr-sm bg-[oklch(93%_0.07_150)] px-3 py-1.5 text-[13px] leading-snug text-zinc-900 shadow-[0_1px_1px_oklch(0%_0_0/0.08)] transition-all duration-500",
        visible ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0",
      )}
    >
      {text}
      <span className="ml-2 inline-flex translate-y-0.5 items-center gap-0.5 text-[10px] text-zinc-500">
        10:42
        <CheckCheck className="h-3 w-3 text-sky-500" />
      </span>
    </div>
  );
}

/** Plays once when scrolled into view, then loops. */
export function RgbsDemo() {
  const ref = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(0);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      setStarted(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setStarted(true);
        observer.disconnect();
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!started) return;
    // 0 = typing, 1..4 = parts shown, then a pause and restart.
    const delay = step === 0 ? 1200 : step <= PARTS.length ? 1100 : 3200;
    const timer = window.setTimeout(() => setStep((value) => (value > PARTS.length ? 0 : value + 1)), delay);
    return () => window.clearTimeout(timer);
  }, [started, step]);

  return (
    <div ref={ref} className="grid gap-4 sm:grid-cols-2">
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
        <p className="mb-4 flex items-center justify-between text-xs font-medium uppercase tracking-[0.12em] text-white/40">
          Sem RGBS
          <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] normal-case tracking-normal">
            1 bloco
          </span>
        </p>
        <div className="min-h-[13.5rem] rounded-xl bg-[oklch(97%_0.01_95)] p-3">
          <Bubble text={ANSWER} visible={started} />
        </div>
        <p className="mt-3 text-xs text-white/40">Parece robô. O contato percebe na hora.</p>
      </div>

      <div className="rounded-2xl border border-white/20 bg-white/[0.06] p-5">
        <p className="mb-4 flex items-center justify-between text-xs font-medium uppercase tracking-[0.12em] text-white/70">
          Com RGBS
          <span className="rounded-full bg-white px-2 py-0.5 text-[10px] normal-case tracking-normal text-zinc-950">
            humano
          </span>
        </p>
        <div className="min-h-[13.5rem] space-y-1.5 rounded-xl bg-[oklch(97%_0.01_95)] p-3">
          {PARTS.map((part, index) => (
            <Bubble key={part} text={part} visible={step > index} />
          ))}
          {step < PARTS.length + 1 && started && (
            <div className="ml-auto flex w-fit items-center gap-1 rounded-xl rounded-tr-sm bg-[oklch(93%_0.07_150)] px-3 py-2.5">
              {[0, 150, 300].map((delay) => (
                <span
                  key={delay}
                  className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-500/70"
                  style={{ animationDelay: `${delay}ms` }}
                />
              ))}
            </div>
          )}
        </div>
        <p className="mt-3 text-xs text-white/60">Mensagens curtas, com o tempo de digitação de uma pessoa.</p>
      </div>
    </div>
  );
}
