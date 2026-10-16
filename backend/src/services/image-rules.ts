import { AgentError } from "./agent.service";

// Rules of an "image" metadado. Each rule becomes one JEV (TypeSafe System One)
// question about the image the contact sent; the image is approved only when
// every rule passes. The AI worker reads the same shape from the payload
// (worker-agentes/<agente>/src/services/jev/imagens.py).
//   noul:   yes/no, passes when the probability of "yes" >= min (0 to 1)
//   choice: one of the options, passes when the chosen option is accepted
//   score:  ordered levels (0, 1, 2...), passes when the score >= min
export type ImageRule =
  | {
      id: string;
      label: string;
      type: "noul";
      instructions: string;
      criteria: { true: string; false: string };
      min: number;
    }
  | {
      id: string;
      label: string;
      type: "choice";
      instructions: string;
      options: { name: string; description: string; accepted: boolean }[];
    }
  | {
      id: string;
      label: string;
      type: "score";
      instructions: string;
      levels: string[];
      min: number;
    };

const MAX_RULES = 10;
const MAX_OPTIONS = 20;
const MAX_LEVELS = 10; // JEV accepts up to 10 score levels.

const text = (value: unknown) => String(value ?? "").trim();

function number(value: unknown, label: string, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new AgentError(400, `${label} deve ficar entre ${min} e ${max}`);
  }
  return parsed;
}

function normalizeRule(raw: unknown, index: number, metadado: string): ImageRule {
  const rule = (raw ?? {}) as Record<string, unknown>;
  const where = `Regra ${index + 1} da imagem "${metadado}"`;
  const id = text(rule.id) || `regra-${index + 1}`;
  const instructions = text(rule.instructions);
  if (!instructions) throw new AgentError(400, `${where}: escreva a pergunta que o JEV deve responder`);
  const label = text(rule.label) || instructions.slice(0, 60);

  if (rule.type === "noul") {
    const criteria = (rule.criteria ?? {}) as Record<string, unknown>;
    return {
      id,
      label,
      type: "noul",
      instructions,
      criteria: { true: text(criteria.true), false: text(criteria.false) },
      min: number(rule.min ?? 0.7, `${where}: a probabilidade mínima`, 0, 1),
    };
  }

  if (rule.type === "choice") {
    if (!Array.isArray(rule.options)) throw new AgentError(400, `${where}: informe as opções`);
    const options = rule.options.map((item) => {
      const option = (item ?? {}) as Record<string, unknown>;
      return { name: text(option.name), description: text(option.description), accepted: Boolean(option.accepted) };
    });
    if (options.length < 2 || options.length > MAX_OPTIONS) {
      throw new AgentError(400, `${where}: use de 2 a ${MAX_OPTIONS} opções`);
    }
    if (options.some((option) => !option.name)) throw new AgentError(400, `${where}: toda opção precisa de nome`);
    const names = options.map((option) => option.name.toLowerCase());
    if (new Set(names).size !== names.length) throw new AgentError(400, `${where}: as opções precisam ter nomes diferentes`);
    if (!options.some((option) => option.accepted)) {
      throw new AgentError(400, `${where}: marque ao menos uma opção como aceita`);
    }
    return { id, label, type: "choice", instructions, options };
  }

  if (rule.type === "score") {
    if (!Array.isArray(rule.levels)) throw new AgentError(400, `${where}: informe os níveis`);
    const levels = rule.levels.map(text);
    if (levels.length < 2 || levels.length > MAX_LEVELS) {
      throw new AgentError(400, `${where}: use de 2 a ${MAX_LEVELS} níveis`);
    }
    if (levels.some((level) => !level)) throw new AgentError(400, `${where}: descreva todos os níveis`);
    return {
      id,
      label,
      type: "score",
      instructions,
      levels,
      min: number(rule.min ?? 1, `${where}: o nível mínimo`, 0, levels.length - 1),
    };
  }

  throw new AgentError(400, `${where}: tipo inválido (use noul, choice ou score)`);
}

/** Validates the rules of an "image" metadado; at least one rule is required. */
export function normalizeImageRules(raw: unknown, metadado: string): ImageRule[] {
  if (!Array.isArray(raw)) throw new AgentError(400, `As regras da imagem "${metadado}" devem ser uma lista`);
  if (!raw.length) throw new AgentError(400, `Cadastre ao menos uma regra para a imagem "${metadado}"`);
  if (raw.length > MAX_RULES) throw new AgentError(400, `Use no máximo ${MAX_RULES} regras por imagem`);
  const rules = raw.map((rule, index) => normalizeRule(rule, index, metadado));
  const ids = rules.map((rule) => rule.id);
  if (new Set(ids).size !== ids.length) {
    rules.forEach((rule, index) => (rule.id = `regra-${index + 1}`));
  }
  return rules;
}

export function imageRulesOf(value: unknown): ImageRule[] {
  return Array.isArray(value) ? (value as ImageRule[]) : [];
}
