export type ModelProvider = "openai" | "anthropic" | "google";

export type ProviderModelOption = {
  provider: ModelProvider;
  id: string;
  label: string;
  description: string;
};

export type ProviderModelSelection = Record<ModelProvider, string>;

const MODEL_OPTIONS: ProviderModelOption[] = [
  {
    provider: "openai",
    id: "gpt-5.4-mini",
    label: "GPT-5.4 Mini",
    description: "Fast OpenAI model with native web search support."
  },
  {
    provider: "openai",
    id: "gpt-5.4",
    label: "GPT-5.4",
    description: "Balanced OpenAI model with native web search support."
  },
  {
    provider: "openai",
    id: "gpt-5.5",
    label: "GPT-5.5",
    description: "Flagship OpenAI model with native web search support."
  },
  {
    provider: "anthropic",
    id: "claude-sonnet-5",
    label: "Claude Sonnet 5",
    description: "Anthropic model with Claude web search support."
  },
  {
    provider: "anthropic",
    id: "claude-opus-4-8",
    label: "Claude Opus 4.8",
    description: "Higher-capability Anthropic model with Claude web search support."
  },
  {
    provider: "google",
    id: "gemini-2.5-flash",
    label: "Gemini 2.5 Flash",
    description: "Fast Gemini model with Google Search grounding."
  },
  {
    provider: "google",
    id: "gemini-2.5-pro",
    label: "Gemini 2.5 Pro",
    description: "Stronger Gemini reasoning model with Google Search grounding."
  },
  {
    provider: "google",
    id: "gemini-3.5-flash",
    label: "Gemini 3.5 Flash",
    description: "Latest Gemini flash-class model with Google Search grounding."
  }
];

export const DEFAULT_PROVIDER_MODEL_SELECTION: ProviderModelSelection = {
  openai: "gpt-5.4-mini",
  anthropic: "claude-sonnet-5",
  google: "gemini-2.5-flash"
};

export function getProviderModelOptions() {
  return MODEL_OPTIONS;
}

export function getProviderModelOptionsByProvider() {
  return {
    openai: MODEL_OPTIONS.filter((option) => option.provider === "openai"),
    anthropic: MODEL_OPTIONS.filter((option) => option.provider === "anthropic"),
    google: MODEL_OPTIONS.filter((option) => option.provider === "google")
  } satisfies Record<ModelProvider, ProviderModelOption[]>;
}

export function getProviderForModel(model: string | null | undefined): ModelProvider | null {
  const normalized = model?.trim().toLowerCase() ?? "";

  if (!normalized) {
    return null;
  }

  const option = MODEL_OPTIONS.find((candidate) => candidate.id.toLowerCase() === normalized);
  return option?.provider ?? null;
}

export function normalizeProviderModelSelection(
  value: Partial<Record<ModelProvider, string>> | null | undefined
): ProviderModelSelection {
  const optionsByProvider = getProviderModelOptionsByProvider();

  return {
    openai: normalizeProviderChoice("openai", value?.openai, optionsByProvider.openai),
    anthropic: normalizeProviderChoice("anthropic", value?.anthropic, optionsByProvider.anthropic),
    google: normalizeProviderChoice("google", value?.google, optionsByProvider.google)
  };
}

function normalizeProviderChoice(
  provider: ModelProvider,
  selected: string | null | undefined,
  options: ProviderModelOption[]
) {
  const match = options.find((option) => option.id === selected?.trim());
  return match?.id ?? DEFAULT_PROVIDER_MODEL_SELECTION[provider];
}
