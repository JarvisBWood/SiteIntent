export type LLMMessageRole = "system" | "user" | "assistant";

export type LLMMessage = {
  role: LLMMessageRole;
  content: string;
};

export type LLMRequest = {
  messages: LLMMessage[];
  model?: string;
  temperature?: number;
  responseFormat?: "text" | "json";
};

export type LLMResponse<T = string> = {
  ok: true;
  model: string;
  content: T;
  raw: unknown;
};

export type LLMFailure = {
  ok: false;
  model: string;
  error: string;
  raw?: unknown;
};

export type LLMSuccess<T = string> = LLMResponse<T>;
export type LLMResult<T = string> = LLMSuccess<T> | LLMFailure;

export class LLMAdapterError extends Error {
  readonly model: string;
  readonly status?: number;
  readonly raw?: unknown;

  constructor(message: string, options: { model: string; status?: number; raw?: unknown }) {
    super(message);
    this.name = "LLMAdapterError";
    this.model = options.model;
    this.status = options.status;
    this.raw = options.raw;
  }
}
