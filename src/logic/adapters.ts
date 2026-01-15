export interface LlmAdapter {
  completeJson(prompt: string): Promise<unknown>;
}

export interface LlmAdapterConfig {
  apiKey?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

export class StubAdapter implements LlmAdapter {
  private readonly response: unknown;

  constructor(response: unknown = { questions: ["What is the target platform?"] }) {
    this.response = response;
  }

  async completeJson(_prompt: string): Promise<unknown> {
    return this.response;
  }
}

export class OpenCodeAdapter implements LlmAdapter {
  private readonly config: LlmAdapterConfig;

  constructor(config: LlmAdapterConfig = {}) {
    this.config = config;
  }

  async completeJson(prompt: string): Promise<unknown> {
    if (!this.config.apiKey) {
      throw new Error("OpenCode API key not configured. Set OPENCODE_API_KEY or pass apiKey in config.");
    }

    throw new Error("OpenCode adapter not yet implemented - awaiting integration layer");
  }
}

export class ClaudeAdapter implements LlmAdapter {
  private readonly config: LlmAdapterConfig;

  constructor(config: LlmAdapterConfig = {}) {
    this.config = {
      model: "claude-sonnet-4-20250514",
      maxTokens: 4096,
      temperature: 0.7,
      ...config,
    };
  }

  async completeJson(prompt: string): Promise<unknown> {
    if (!this.config.apiKey) {
      throw new Error("Anthropic API key not configured. Set ANTHROPIC_API_KEY or pass apiKey in config.");
    }

    throw new Error("Claude adapter not yet implemented - awaiting integration layer");
  }
}

export type AdapterType = "stub" | "opencode" | "claude";

export function createAdapter(type: AdapterType, config?: LlmAdapterConfig): LlmAdapter {
  switch (type) {
    case "stub":
      return new StubAdapter();
    case "opencode":
      return new OpenCodeAdapter(config);
    case "claude":
      return new ClaudeAdapter(config);
    default:
      throw new Error(`Unknown adapter type: ${type}`);
  }
}

export function createAdapterFromEnv(): LlmAdapter {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) {
    return new ClaudeAdapter({ apiKey: anthropicKey });
  }

  const opencodeKey = process.env.OPENCODE_API_KEY;
  if (opencodeKey) {
    return new OpenCodeAdapter({ apiKey: opencodeKey });
  }

  console.warn("No LLM API key found in environment. Using stub adapter.");
  return new StubAdapter();
}
