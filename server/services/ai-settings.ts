import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { z } from "zod";
import { storage } from "../storage";
import { appConfig } from "../config";

export const aiProviderSchema = z.enum(["openai", "anthropic", "gemini"]);

export type AiProvider = z.infer<typeof aiProviderSchema>;

export interface AiSettings {
  provider: AiProvider;
  model: string;
  apiKey: string;
  baseUrl?: string | null;
}

export interface AiSettingsSummary {
  provider: AiProvider | null;
  model: string | null;
  baseUrl: string | null;
  configured: boolean;
  hasApiKey: boolean;
  apiKeyMasked: string | null;
}

const AI_SETTING_KEYS = {
  provider: "ai_provider",
  model: "ai_model",
  apiKey: "ai_api_key",
  baseUrl: "ai_base_url",
} as const;

const ENCRYPTED_PREFIX = "enc:v1:";

const aiSettingsInputSchema = z.object({
  provider: aiProviderSchema,
  model: z.string().trim().min(1).max(255),
  baseUrl: z.string().trim().max(500).optional().nullable(),
  apiKey: z.string().trim().max(500).optional(),
  clearApiKey: z.boolean().optional().default(false),
}).superRefine((value, ctx) => {
  if (!value.apiKey && !value.clearApiKey) {
    return;
  }

  if (value.apiKey !== undefined && value.apiKey.trim().length === 0 && !value.clearApiKey) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "API key cannot be empty",
      path: ["apiKey"],
    });
  }
});

export type AiSettingsInput = z.infer<typeof aiSettingsInputSchema>;

const getEncryptionKey = () =>
  createHash("sha256").update(appConfig.session.secret).digest();

const encryptValue = (value: string) => {
  if (!value) {
    return "";
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${ENCRYPTED_PREFIX}${iv.toString("base64url")}.${authTag.toString("base64url")}.${encrypted.toString("base64url")}`;
};

const decryptValue = (value?: string | null) => {
  if (!value) {
    return "";
  }

  if (!value.startsWith(ENCRYPTED_PREFIX)) {
    return value;
  }

  const rawPayload = value.slice(ENCRYPTED_PREFIX.length);
  const [ivPart, authTagPart, encryptedPart] = rawPayload.split(".");
  if (!ivPart || !authTagPart || !encryptedPart) {
    throw new Error("Invalid encrypted AI API key payload");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    getEncryptionKey(),
    Buffer.from(ivPart, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(authTagPart, "base64url"));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedPart, "base64url")),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
};

const normalizeBaseUrl = (value?: string | null) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed.replace(/\/+$/, "") : null;
};

const maskApiKey = (value?: string | null) => {
  if (!value) {
    return null;
  }

  if (value.length <= 8) {
    return "*".repeat(value.length);
  }

  return `${value.slice(0, 4)}${"*".repeat(Math.max(4, value.length - 8))}${value.slice(-4)}`;
};

export const getAiSettingsSummary = async (): Promise<AiSettingsSummary> => {
  const [providerSetting, modelSetting, apiKeySetting, baseUrlSetting] = await Promise.all([
    storage.getSystemSetting(AI_SETTING_KEYS.provider),
    storage.getSystemSetting(AI_SETTING_KEYS.model),
    storage.getSystemSetting(AI_SETTING_KEYS.apiKey),
    storage.getSystemSetting(AI_SETTING_KEYS.baseUrl),
  ]);

  const provider = aiProviderSchema.safeParse(providerSetting?.value ?? null);
  const decryptedApiKey = decryptValue(apiKeySetting?.value);
  const hasApiKey = decryptedApiKey.trim().length > 0;
  const model = modelSetting?.value?.trim() || null;
  const baseUrl = normalizeBaseUrl(baseUrlSetting?.value);

  return {
    provider: provider.success ? provider.data : null,
    model,
    baseUrl,
    configured: Boolean(provider.success && model && hasApiKey),
    hasApiKey,
    apiKeyMasked: hasApiKey ? maskApiKey(decryptedApiKey) : null,
  };
};

export const getAiSettings = async (): Promise<AiSettings | null> => {
  const [providerSetting, modelSetting, apiKeySetting, baseUrlSetting] = await Promise.all([
    storage.getSystemSetting(AI_SETTING_KEYS.provider),
    storage.getSystemSetting(AI_SETTING_KEYS.model),
    storage.getSystemSetting(AI_SETTING_KEYS.apiKey),
    storage.getSystemSetting(AI_SETTING_KEYS.baseUrl),
  ]);

  const provider = aiProviderSchema.safeParse(providerSetting?.value ?? null);
  const model = modelSetting?.value?.trim();
  const apiKey = decryptValue(apiKeySetting?.value).trim();

  if (!provider.success || !model || !apiKey) {
    return null;
  }

  return {
    provider: provider.data,
    model,
    apiKey,
    baseUrl: normalizeBaseUrl(baseUrlSetting?.value),
  };
};

export const updateAiSettings = async (
  input: AiSettingsInput,
): Promise<AiSettingsSummary> => {
  const parsedInput = aiSettingsInputSchema.parse(input);
  const currentSettings = await getAiSettings();
  const nextApiKey = parsedInput.clearApiKey
    ? ""
    : parsedInput.apiKey?.trim() ?? currentSettings?.apiKey ?? "";

  await Promise.all([
    storage.setSystemSetting({
      key: AI_SETTING_KEYS.provider,
      value: parsedInput.provider,
      description: "AI provider for academy automation",
    }),
    storage.setSystemSetting({
      key: AI_SETTING_KEYS.model,
      value: parsedInput.model.trim(),
      description: "AI model for academy automation",
    }),
    storage.setSystemSetting({
      key: AI_SETTING_KEYS.baseUrl,
      value: normalizeBaseUrl(parsedInput.baseUrl) ?? "",
      description: "Optional base URL for the AI provider",
    }),
    storage.setSystemSetting({
      key: AI_SETTING_KEYS.apiKey,
      value: nextApiKey ? encryptValue(nextApiKey) : "",
      description: "Encrypted API key for the AI provider",
    }),
  ]);

  return getAiSettingsSummary();
};

export { aiSettingsInputSchema };
