import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AnthropicExtractionProvider,
  AnthropicProviderConfigError,
  AnthropicProviderRequestError,
  AnthropicProviderResponseError,
  AnthropicProviderTimeoutError,
  buildExtractionOutputSchema,
} from "@/server/ai-extraction/providers/anthropic-provider";
import type { AiExtractionVisibleQuestion } from "@/server/ai-extraction/types";

/**
 * Unit-Tests fuer `anthropic-provider.ts` (AP5c-PoC, Phase 12 AP5).
 * AUSSCHLIESSLICH gemockter `fetch` -- KEIN echter Netzwerkzugriff, damit
 * diese Datei sicher Teil der normalen Push-/PR-CI ist (siehe
 * `run.ts`-Modulkommentar: die echten API-Calls laufen ausschliesslich
 * ueber `npm run test:ai-poc`, niemals hier). Deckt die Fehlerpfade
 * (fehlender API-Key, Nicht-2xx-Status, Timeout, ungueltiges JSON,
 * Refusal) sowie die Schema-/Mapping-Bausteine ab.
 */

const ROAMING_QUESTION: AiExtractionVisibleQuestion = {
  questionId: "q-roaming",
  label: "EU-Roaming gewuenscht",
  answerType: "BOOLEAN",
  answerOptions: [],
  minValue: null,
  maxValue: null,
  maxLength: null,
  minSelections: null,
  maxSelections: null,
};

const TARIFF_QUESTION: AiExtractionVisibleQuestion = {
  questionId: "q-tarif",
  label: "Gewuenschter Tarif",
  answerType: "SINGLE_CHOICE",
  answerOptions: [
    { key: "s", label: "Tarif S" },
    { key: "m", label: "Tarif M" },
  ],
  minValue: null,
  maxValue: null,
  maxLength: null,
  minSelections: null,
  maxSelections: null,
};

function anthropicResponse(overrides: Record<string, unknown> = {}): Response {
  const body = {
    content: [{ type: "text", text: JSON.stringify({ candidates: [] }) }],
    stop_reason: "end_turn",
    usage: { input_tokens: 10, output_tokens: 5 },
    ...overrides,
  };
  return new Response(JSON.stringify(body), { status: 200 });
}

describe("buildExtractionOutputSchema", () => {
  it("beschraenkt questionId per Enum auf den sichtbaren Katalog", () => {
    const schema = buildExtractionOutputSchema([ROAMING_QUESTION, TARIFF_QUESTION]) as {
      properties: {
        candidates: { items: { properties: { questionId: { enum: string[] } } } };
      };
    };
    expect(schema.properties.candidates.items.properties.questionId.enum).toEqual([
      "q-roaming",
      "q-tarif",
    ]);
  });

  it("erzwingt additionalProperties: false auf beiden Ebenen", () => {
    const schema = buildExtractionOutputSchema([ROAMING_QUESTION]) as {
      additionalProperties: boolean;
      properties: { candidates: { items: { additionalProperties: boolean } } };
    };
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.candidates.items.additionalProperties).toBe(false);
  });
});

describe("AnthropicExtractionProvider.extract", () => {
  const originalApiKey = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "test-key-synthetic";
  });

  afterEach(() => {
    process.env.ANTHROPIC_API_KEY = originalApiKey;
    vi.unstubAllGlobals();
  });

  it("wirft AnthropicProviderConfigError, wenn kein API-Key gesetzt ist", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const provider = new AnthropicExtractionProvider();
    await expect(
      provider.extract({ freeText: "Test", visibleQuestions: [ROAMING_QUESTION] }),
    ).rejects.toThrow(AnthropicProviderConfigError);
  });

  it("ruft die API nicht auf und liefert [] bei leerem sichtbarem Katalog", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const provider = new AnthropicExtractionProvider();
    const candidates = await provider.extract({ freeText: "irrelevant", visibleQuestions: [] });
    expect(candidates).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("mappt eine valide Antwort korrekt auf AiExtractionCandidate[]", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        anthropicResponse({
          content: [
            {
              type: "text",
              text: JSON.stringify({
                candidates: [
                  { questionId: "q-roaming", answerType: "BOOLEAN", booleanValue: true },
                ],
              }),
            },
          ],
        }),
      ),
    );
    const provider = new AnthropicExtractionProvider();
    const candidates = await provider.extract({
      freeText: "Kunde moechte Roaming.",
      visibleQuestions: [ROAMING_QUESTION],
    });
    expect(candidates).toEqual([
      { questionId: "q-roaming", answerType: "BOOLEAN", booleanValue: true },
    ]);
  });

  it("liefert [] bei stop_reason 'refusal' statt einen Fehler zu werfen", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        anthropicResponse({
          content: [{ type: "text", text: "" }],
          stop_reason: "refusal",
        }),
      ),
    );
    const provider = new AnthropicExtractionProvider();
    const candidates = await provider.extract({
      freeText: "irrelevant",
      visibleQuestions: [ROAMING_QUESTION],
    });
    expect(candidates).toEqual([]);
  });

  it("wirft AnthropicProviderRequestError bei Nicht-2xx-Status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { type: "authentication_error" } }), {
          status: 401,
        }),
      ),
    );
    const provider = new AnthropicExtractionProvider();
    await expect(
      provider.extract({ freeText: "x", visibleQuestions: [ROAMING_QUESTION] }),
    ).rejects.toThrow(AnthropicProviderRequestError);
  });

  it("wirft AnthropicProviderTimeoutError bei AbortError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(Object.assign(new Error("aborted"), { name: "AbortError" })),
    );
    const provider = new AnthropicExtractionProvider();
    await expect(
      provider.extract({ freeText: "x", visibleQuestions: [ROAMING_QUESTION] }),
    ).rejects.toThrow(AnthropicProviderTimeoutError);
  });

  it("wirft AnthropicProviderResponseError bei ungueltigem JSON im Text-Block", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          anthropicResponse({ content: [{ type: "text", text: "kein-json{{{" }] }),
        ),
    );
    const provider = new AnthropicExtractionProvider();
    await expect(
      provider.extract({ freeText: "x", visibleQuestions: [ROAMING_QUESTION] }),
    ).rejects.toThrow(AnthropicProviderResponseError);
  });

  it("extractWithUsage liefert Tokenverbrauch und Latenz fuer den PoC-Report", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(anthropicResponse()));
    const provider = new AnthropicExtractionProvider();
    const result = await provider.extractWithUsage({
      freeText: "x",
      visibleQuestions: [ROAMING_QUESTION],
    });
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
    expect(result.stopReason).toBe("end_turn");
    expect(typeof result.latencyMs).toBe("number");
  });
});
