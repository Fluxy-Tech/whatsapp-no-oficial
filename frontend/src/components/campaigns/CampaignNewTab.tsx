import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import Papa from "papaparse";
import {
  Braces,
  CheckCircle2,
  CircleAlert,
  Download,
  Eye,
  FileSpreadsheet,
  FileText,
  Send,
  Smartphone,
  Upload,
  Users,
  XCircle,
} from "lucide-react";
import { api } from "@/lib/api";
import { fillVariables, normalizePhone, templateVariables, TONE_CLASSES } from "@/lib/campaigns";
import { formatPhone } from "@/lib/dashboard";
import { cn } from "@/lib/utils";
import { useSocket } from "@/providers/SocketProvider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { WhatsappPreview } from "@/components/campaigns/WhatsappPreview";

type WhatsappStatus = { status: string; phoneNumber: string | null };

type ParsedRow = { index: number; phone: string; name: string; variables: string[]; errors: string[] };

type ContactPayload = { phone: string; name?: string; variables: string[] };

function normalizeKey(key: string): string {
  return key
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** Validates the CSV records against the template (re-run when the variable count changes). */
function parseRows(raw: Record<string, string>[], variableCount: number): ParsedRow[] {
  const seen = new Map<string, number>();
  return raw.map((rawRow, i) => {
    const normalized: Record<string, string> = {};
    for (const [k, v] of Object.entries(rawRow)) normalized[normalizeKey(k)] = (v ?? "").toString().trim();

    const phone = normalizePhone(normalized.telefone ?? normalized.phone ?? normalized.celular ?? "");
    const name = normalized.nome ?? normalized.name ?? "";
    const errors: string[] = [];

    if (phone.length < 8 || phone.length > 15) errors.push("Telefone ausente ou inválido");
    else if (seen.has(phone)) errors.push(`Telefone repetido (linha ${seen.get(phone)})`);
    else seen.set(phone, i + 1);

    const variables: string[] = [];
    for (let v = 1; v <= variableCount; v++) {
      const value = normalized[`variavel${v}`] ?? normalized[`var${v}`] ?? "";
      variables.push(value);
      if (!value) errors.push(`Variável ${v} ausente`);
    }

    return { index: i + 1, phone, name, variables, errors };
  });
}

/** "Nova campanha": hand-written message with {{n}} variables, sent through the connected WhatsApp. */
export function CampaignNewTab() {
  const navigate = useNavigate();
  const socket = useSocket();
  const templateRef = useRef<HTMLTextAreaElement>(null);

  const [whatsapp, setWhatsapp] = useState<WhatsappStatus | null>(null);
  const [templateText, setTemplateText] = useState("");
  const [campaignName, setCampaignName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [checkingBlocked, setCheckingBlocked] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filled when /blocked-contacts finds blocked contacts: opens the
  // confirmation instead of sending right away.
  const [blockedPhones, setBlockedPhones] = useState<string[] | null>(null);
  const [pendingContacts, setPendingContacts] = useState<ContactPayload[] | null>(null);

  const [mode, setMode] = useState<"CSV" | "MANUAL">("CSV");
  const [rawRecords, setRawRecords] = useState<Record<string, string>[] | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  const [manualPhone, setManualPhone] = useState("");
  const [manualName, setManualName] = useState("");
  const [manualVariables, setManualVariables] = useState<string[]>([]);

  // CSV sends go out in batches: batchSize contacts every batchIntervalMinutes.
  const [batchSize, setBatchSize] = useState("");
  const [batchIntervalMinutes, setBatchIntervalMinutes] = useState("");
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  // Raw <input type="datetime-local"> value (local time, no time zone).
  const [scheduledAt, setScheduledAt] = useState("");

  useEffect(() => {
    api<WhatsappStatus>("/api/whatsapp/status")
      .then(setWhatsapp)
      .catch(() => setWhatsapp({ status: "ERROR", phoneNumber: null }));
    function onStatus({ status, phoneNumber }: { status: string; phoneNumber?: string | null }) {
      setWhatsapp((current) => ({ status, phoneNumber: phoneNumber ?? current?.phoneNumber ?? null }));
    }
    socket.on("whatsapp:status", onStatus);
    return () => {
      socket.off("whatsapp:status", onStatus);
    };
  }, [socket]);

  const connected = whatsapp?.status === "CONNECTED";
  const { count: totalVars, error: templateError } = useMemo(() => templateVariables(templateText), [templateText]);
  const templateValid = Boolean(templateText.trim()) && !templateError;

  const rows = useMemo(() => (rawRecords ? parseRows(rawRecords, totalVars) : null), [rawRecords, totalVars]);
  const validRows = useMemo(() => rows?.filter((r) => r.errors.length === 0) ?? [], [rows]);
  const invalidRows = useMemo(() => rows?.filter((r) => r.errors.length > 0) ?? [], [rows]);

  const manualPhoneDigits = normalizePhone(manualPhone);
  const manualPhoneInvalid = Boolean(manualPhone) && (manualPhoneDigits.length < 8 || manualPhoneDigits.length > 15);
  const manualValues = Array.from({ length: totalVars }, (_, i) => manualVariables[i] ?? "");
  const manualMissingVariable = manualValues.some((v) => !v.trim());

  const batchSizeNumber = Number(batchSize);
  const batchIntervalNumber = Number(batchIntervalMinutes);
  const pacingValid =
    mode !== "CSV" ||
    (Number.isInteger(batchSizeNumber) && batchSizeNumber >= 1 && Number.isInteger(batchIntervalNumber) && batchIntervalNumber >= 1);
  const totalBatches = pacingValid && batchSizeNumber > 0 ? Math.ceil(validRows.length / batchSizeNumber) : 0;
  const totalDurationMinutes = Math.max(totalBatches - 1, 0) * batchIntervalNumber;

  const scheduledDate = scheduleEnabled && scheduledAt ? new Date(scheduledAt) : null;
  const scheduleValid = !scheduleEnabled || (scheduledDate !== null && scheduledDate.getTime() > Date.now());

  const canSubmit = Boolean(
    connected &&
      templateValid &&
      campaignName.trim() &&
      !submitting &&
      !checkingBlocked &&
      (mode === "CSV"
        ? rows && rows.length > 0 && invalidRows.length === 0
        : manualPhoneDigits.length >= 8 && !manualPhoneInvalid && !manualMissingVariable) &&
      pacingValid &&
      scheduleValid,
  );

  /** Inserts the next {{n}} at the cursor. */
  function insertVariable() {
    const textarea = templateRef.current;
    const token = `{{${totalVars + 1}}}`;
    const start = textarea?.selectionStart ?? templateText.length;
    const end = textarea?.selectionEnd ?? templateText.length;
    setTemplateText(templateText.slice(0, start) + token + templateText.slice(end));
    requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(start + token.length, start + token.length);
    });
  }

  function handleFile(file: File) {
    setFileName(file.name);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: "greedy",
      complete: (results) => setRawRecords(results.data),
      error: () => {
        setError("Não foi possível ler o arquivo CSV.");
        setRawRecords(null);
      },
    });
  }

  function downloadModel() {
    const header = ["telefone", "nome"];
    const example = ["5511999999999", "Maria Silva"];
    for (let v = 1; v <= totalVars; v++) {
      header.push(`variavel${v}`);
      example.push(`valor da variável ${v}`);
    }
    // BOM so Excel opens the accents correctly.
    const csv = "﻿" + Papa.unparse({ fields: header, data: [example] });
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `modelo-${campaignName.trim() || "campanha"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function buildContacts(): ContactPayload[] {
    if (mode === "CSV") {
      return validRows.map((r) => ({ phone: r.phone, name: r.name || undefined, variables: r.variables }));
    }
    return [{ phone: manualPhoneDigits, name: manualName.trim() || undefined, variables: manualValues.map((v) => v.trim()) }];
  }

  async function dispatchCampaign(contacts: ContactPayload[]) {
    if (contacts.length === 0) {
      setError("Nenhum contato restou para o disparo.");
      return;
    }
    setSubmitting(true);
    try {
      const result = await api<{ id: string }>("/api/campaigns", {
        method: "POST",
        body: JSON.stringify({
          name: campaignName.trim(),
          templateText,
          dispatchType: mode,
          contacts,
          batchSize: mode === "CSV" ? batchSizeNumber : undefined,
          batchIntervalMinutes: mode === "CSV" ? batchIntervalNumber : undefined,
          scheduledAt: scheduledDate ? scheduledDate.toISOString() : undefined,
        }),
      });
      navigate(`/dashboard/campanhas/${result.id}`);
    } catch (err) {
      setError((err as Error).message || "Não foi possível criar a campanha.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmit() {
    setError(null);
    const contacts = buildContacts();

    setCheckingBlocked(true);
    try {
      const { blockedPhones: blocked } = await api<{ blockedPhones: string[] }>("/api/campaigns/blocked-contacts", {
        method: "POST",
        body: JSON.stringify({ phones: contacts.map((c) => c.phone) }),
      });
      if (blocked.length > 0) {
        setBlockedPhones(blocked);
        setPendingContacts(contacts);
        return;
      }
      await dispatchCampaign(contacts);
    } catch (err) {
      setError((err as Error).message || "Não foi possível verificar contatos bloqueados.");
    } finally {
      setCheckingBlocked(false);
    }
  }

  function handleCancelBlocked() {
    setBlockedPhones(null);
    setPendingContacts(null);
  }

  async function handleContinueWithoutBlocked() {
    if (!pendingContacts || !blockedPhones) return;
    const blockedSet = new Set(blockedPhones);
    const filtered = pendingContacts.filter((c) => !blockedSet.has(c.phone));
    setBlockedPhones(null);
    setPendingContacts(null);
    await dispatchCampaign(filtered);
  }

  const modeButton = (value: "CSV" | "MANUAL", label: string) => (
    <button
      type="button"
      onClick={() => setMode(value)}
      className={cn(
        "rounded-md border px-3 py-1 text-xs font-medium transition-colors",
        mode === value ? "border-primary bg-primary text-primary-foreground" : "border-input bg-background hover:bg-accent",
      )}
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-col gap-4">
      <Dialog open={blockedPhones !== null} onOpenChange={(open) => !open && handleCancelBlocked()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Contatos bloqueados para campanha</DialogTitle>
            <DialogDescription>
              {blockedPhones?.length} contato(s) já pediram para não receber mais mensagens de campanha e não serão
              incluídos neste disparo: {blockedPhones?.join(", ")}. Deseja continuar o disparo sem eles?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={handleCancelBlocked}>
              Cancelar
            </Button>
            <Button onClick={() => void handleContinueWithoutBlocked()}>Continuar sem eles</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Smartphone className="h-5 w-5" />
            </span>
            <div>
              <CardTitle className="text-base">WhatsApp de envio</CardTitle>
              <CardDescription>
                A campanha sai pelo WhatsApp conectado da empresa. Se ele desconectar, a campanha é pausada.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {!whatsapp ? (
            <p className="text-sm text-muted-foreground">Verificando conexão...</p>
          ) : connected ? (
            <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-medium", TONE_CLASSES.good)}>
              <CheckCircle2 className="h-4 w-4" />
              Conectado{whatsapp.phoneNumber ? ` · ${formatPhone(whatsapp.phoneNumber)}` : ""}
            </span>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-medium", TONE_CLASSES.critical)}>
                <CircleAlert className="h-4 w-4" />
                WhatsApp desconectado
              </span>
              <Button variant="link" className="h-auto p-0 text-sm" onClick={() => navigate("/dashboard/configuracoes")}>
                Conectar em Configurações
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <FileText className="h-5 w-5" />
            </span>
            <div>
              <CardTitle className="text-base">Template</CardTitle>
              <CardDescription>
                Escreva a mensagem. Use {"{{1}}"}, {"{{2}}"}... onde cada contato recebe um valor diferente (nome, data,
                cupom...).
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Textarea
            ref={templateRef}
            id="campaign-template"
            rows={7}
            value={templateText}
            onChange={(e) => setTemplateText(e.target.value)}
            placeholder={"Olá {{1}}, tudo bem?\n\nSeu pedido *{{2}}* já está disponível para retirada."}
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button type="button" variant="outline" size="sm" className="gap-2" onClick={insertVariable}>
              <Braces className="h-4 w-4" /> Inserir variável {`{{${totalVars + 1}}}`}
            </Button>
            <p className="text-xs text-muted-foreground">
              Formatação do WhatsApp: *negrito*, _itálico_, ~tachado~ · {templateText.length}/4096
            </p>
          </div>
          {templateError && <p className="text-sm text-destructive">{templateError}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Eye className="h-5 w-5" />
            </span>
            <div>
              <CardTitle className="text-base">Pré-visualização</CardTitle>
              <CardDescription>Confira como a mensagem vai chegar para o contato.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4 sm:flex-row">
            <WhatsappPreview
              className="flex-1"
              text={fillVariables(templateText, mode === "MANUAL" ? manualValues : undefined)}
            />
            <div className="flex flex-1 flex-col gap-3 text-sm">
              <div>
                <span className="inline-flex rounded-full bg-primary/10 px-3 py-1 text-sm font-semibold text-primary">
                  {totalVars} variáve{totalVars === 1 ? "l" : "is"} por contato
                </span>
                {totalVars > 0 && (
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    {mode === "MANUAL"
                      ? "Preencha cada variável para ver a mensagem final ao lado."
                      : `O CSV precisa das colunas ${Array.from({ length: totalVars }, (_, i) => `variavel${i + 1}`).join(", ")}.`}
                  </p>
                )}
              </div>

              {mode === "MANUAL" &&
                manualValues.map((value, i) => (
                  <div key={i} className="rounded-lg border p-3">
                    <div className="mb-1.5 flex items-center gap-2">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm bg-primary/10 text-xs font-semibold text-primary">
                        {i + 1}
                      </span>
                      <Label htmlFor={`preview-var-${i}`} className="text-xs font-normal">
                        Variável {`{{${i + 1}}}`}
                      </Label>
                    </div>
                    <Input
                      id={`preview-var-${i}`}
                      value={value}
                      onChange={(e) =>
                        setManualVariables(() => {
                          const next = [...manualValues];
                          next[i] = e.target.value;
                          return next;
                        })
                      }
                    />
                  </div>
                ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Users className="h-5 w-5" />
            </span>
            <div>
              <CardTitle className="text-base">Contatos</CardTitle>
              <CardDescription>Informe quem vai receber o disparo — em massa (CSV) ou manual.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex gap-1.5">
            {modeButton("CSV", "Importar CSV")}
            {modeButton("MANUAL", "Disparo manual")}
          </div>

          {mode === "CSV" ? (
            <>
              <div className="flex flex-col gap-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Label htmlFor="campaign-csv">
                    Arquivo CSV: telefone (DDD + número), nome (opcional)
                    {totalVars > 0 ? ` e variavel1 a variavel${totalVars}` : ""}
                  </Label>
                  <Button type="button" variant="outline" size="sm" className="gap-2" onClick={downloadModel}>
                    <Download className="h-4 w-4" /> Baixar modelo CSV
                  </Button>
                </div>
                <label
                  htmlFor="campaign-csv"
                  className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-primary/40 bg-primary/5 px-4 py-8 text-center transition-colors hover:bg-primary/10"
                >
                  <Upload className="h-6 w-6 text-primary" />
                  <p className="text-sm text-muted-foreground">{fileName ?? "Clique para anexar o arquivo CSV."}</p>
                  <input
                    id="campaign-csv"
                    type="file"
                    accept=".csv,text/csv"
                    onChange={(e) => {
                      if (e.target.files?.[0]) handleFile(e.target.files[0]);
                      e.target.value = "";
                    }}
                    className="hidden"
                  />
                </label>
              </div>

              {rows && rows.length === 0 && <p className="text-sm text-muted-foreground">O arquivo não tem contatos.</p>}
              {rows && rows.length > 0 && (
                <div className="flex flex-col gap-3">
                  <div className="flex gap-4 text-sm">
                    <span className="flex items-center gap-1.5 text-emerald-700">
                      <CheckCircle2 className="h-4 w-4" /> {validRows.length} corretos
                    </span>
                    <span className="flex items-center gap-1.5 text-destructive">
                      <XCircle className="h-4 w-4" /> {invalidRows.length} com erro
                    </span>
                  </div>
                  <div className="max-h-80 overflow-auto rounded-md border">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-muted text-left text-xs text-muted-foreground">
                        <tr>
                          <th className="w-12 px-3 py-2 font-medium">#</th>
                          <th className="px-3 py-2 font-medium">Telefone</th>
                          <th className="px-3 py-2 font-medium">Nome</th>
                          <th className="px-3 py-2 font-medium">Variáveis</th>
                          <th className="px-3 py-2 font-medium">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {rows.map((r) => (
                          <tr key={r.index}>
                            <td className="px-3 py-2 text-muted-foreground">{r.index}</td>
                            <td className="px-3 py-2">{r.phone || "—"}</td>
                            <td className="px-3 py-2">{r.name || "—"}</td>
                            <td className="max-w-56 truncate px-3 py-2 text-muted-foreground">
                              {r.variables.filter(Boolean).join(", ") || "—"}
                            </td>
                            <td className="px-3 py-2">
                              {r.errors.length === 0 ? (
                                <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", TONE_CLASSES.good)}>
                                  Correto
                                </span>
                              ) : (
                                <span className="text-xs text-destructive">{r.errors.join(", ")}</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="manual-phone">Telefone (DDD + número; DDI opcional para o Brasil)</Label>
                <Input
                  id="manual-phone"
                  inputMode="tel"
                  placeholder="5511999999999"
                  value={manualPhone}
                  onChange={(e) => setManualPhone(e.target.value)}
                />
                {manualPhoneInvalid && <p className="text-xs text-destructive">Telefone inválido</p>}
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="manual-name">Nome (opcional)</Label>
                <Input id="manual-name" value={manualName} onChange={(e) => setManualName(e.target.value)} />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Send className="h-5 w-5" />
            </span>
            <div>
              <CardTitle className="text-base">Disparo</CardTitle>
              <CardDescription>Dê um nome à campanha e clique em disparar quando estiver tudo pronto.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="campaign-name">Nome da campanha</Label>
            <Input
              id="campaign-name"
              value={campaignName}
              onChange={(e) => setCampaignName(e.target.value)}
              placeholder="Ex: Promoção de aniversário"
            />
          </div>

          {mode === "CSV" && (
            <div className="flex flex-col gap-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="campaign-batch-size">Disparos por lote</Label>
                  <Input
                    id="campaign-batch-size"
                    type="number"
                    min={1}
                    step={1}
                    value={batchSize}
                    onChange={(e) => setBatchSize(e.target.value)}
                    placeholder="Ex: 10"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="campaign-batch-interval">Intervalo entre lotes (minutos)</Label>
                  <Input
                    id="campaign-batch-interval"
                    type="number"
                    min={1}
                    step={1}
                    value={batchIntervalMinutes}
                    onChange={(e) => setBatchIntervalMinutes(e.target.value)}
                    placeholder="Ex: 10"
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                {pacingValid && validRows.length > 0
                  ? `${validRows.length} contato(s) em ${totalBatches} lote(s) de até ${batchSizeNumber}, com ${batchIntervalNumber} min entre eles — duração estimada de ${totalDurationMinutes} min. Você pode pausar a campanha a qualquer momento pela tela de detalhes.`
                  : "O disparo em massa é enviado em lotes: informe quantos contatos por vez e quanto tempo esperar entre um lote e o próximo."}
              </p>
            </div>
          )}

          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <Switch checked={scheduleEnabled} onCheckedChange={setScheduleEnabled} aria-label="Agendar disparo" />
              <div>
                <Label>Agendar disparo</Label>
                <p className="text-xs text-muted-foreground">Escolha a data e o horário em que a campanha deve começar.</p>
              </div>
            </div>
            {scheduleEnabled && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="campaign-scheduled-at">Início do disparo</Label>
                <Input
                  id="campaign-scheduled-at"
                  type="datetime-local"
                  className="w-fit"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                />
                {scheduledAt && !scheduleValid && (
                  <p className="text-xs text-destructive">Escolha uma data e horário no futuro.</p>
                )}
              </div>
            )}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
          {!connected && whatsapp && (
            <p className="text-sm text-destructive">Conecte o WhatsApp da empresa para disparar a campanha.</p>
          )}

          <Button type="button" disabled={!canSubmit} onClick={() => void handleSubmit()} className="w-fit gap-2">
            <FileSpreadsheet className="h-4 w-4" />
            {checkingBlocked
              ? "Verificando contatos…"
              : submitting
                ? "Enviando..."
                : scheduleEnabled
                  ? "Agendar campanha"
                  : "Disparar campanha"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
