
import "server-only";

import {
  createDecipheriv,
  createHash,
} from "node:crypto";

type JsonRecord = Record<string, any>;

type GeneratedItem = {
  channel: string;
  title: string;
  body: string;
};

function decryptAiKey(encrypted: string): string {
  const secret = process.env.API_CREDENTIALS_ENCRYPTION_KEY;

  if (!secret || secret.length < 32) {
    throw new Error(
      "AI credential encryption is not configured correctly on the server.",
    );
  }

  const parts = encrypted.split(":");

  if (
    parts.length !== 5 ||
    parts[0] !== "enc" ||
    parts[1] !== "v1"
  ) {
    throw new Error(
      "The saved AI API key has an unsupported format. Please save the key again in Profile settings.",
    );
  }

  const [, , ivText, tagText, encryptedText] = parts;

  const key = createHash("sha256")
    .update(secret)
    .digest();

  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(ivText, "base64"),
  );

  decipher.setAuthTag(Buffer.from(tagText, "base64"));

  return Buffer.concat([
    decipher.update(Buffer.from(encryptedText, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };

    return entities[character] || character;
  });
}

function normalizeProvider(value: unknown): string {
  const provider = String(value || "").trim().toLowerCase();

  if (provider.includes("anthropic") || provider.includes("claude")) {
    return "anthropic";
  }

  if (
    provider.includes("google") ||
    provider.includes("gemini")
  ) {
    return "google";
  }

  if (provider.includes("groq")) {
    return "groq";
  }

  if (provider.includes("openai") || provider === "gpt") {
    return "openai";
  }

  return provider;
}

function extractText(provider: string, response: JsonRecord): string {
  if (provider === "anthropic") {
    return (response.content || [])
      .filter((part: JsonRecord) => part.type === "text")
      .map((part: JsonRecord) => String(part.text || ""))
      .join("\n");
  }

  if (provider === "google") {
    return (response.candidates?.[0]?.content?.parts || [])
      .map((part: JsonRecord) => String(part.text || ""))
      .join("\n");
  }

  return String(response.choices?.[0]?.message?.content || "");
}

function parseGeneratedItems(raw: string): GeneratedItem[] {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");

  let parsed: JsonRecord;

  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");

    if (start < 0 || end <= start) {
      throw new Error(
        "The AI provider returned content in an unreadable format. Please retry.",
      );
    }

    try {
      parsed = JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      throw new Error(
        "The AI provider returned invalid JSON. Please retry.",
      );
    }
  }

  const source = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed.items)
      ? parsed.items
      : [];

  const items: GeneratedItem[] = source
    .filter(
      (item: JsonRecord) =>
        item &&
        typeof item.body === "string" &&
        item.body.trim().length > 0,
    )
    .map((item: JsonRecord) => ({
      channel: String(item.channel || "Generated").trim().slice(0, 80),
      title: String(item.title || "Generated content").trim().slice(0, 200),
      body: String(item.body).trim().slice(0, 30000),
    }));

  if (!items.length) {
    throw new Error(
      "The AI provider returned no usable content. Check your model and try again.",
    );
  }

  return items;
}

function makeStudioHtml(items: GeneratedItem[]): string {
  const cards = items.map((item, index) => {
    const paragraphs = item.body
      .split(/\n{2,}/)
      .map((paragraph) => {
        const safe = escapeHtml(paragraph).replace(/\n/g, "<br/>");
        return `<p>${safe}</p>`;
      })
      .join("");

    return `
      <article class="media-card" data-channel="${escapeHtml(item.channel)}" data-card-id="personal-${index + 1}">
        <div class="media-card-head">
          <h4>${escapeHtml(item.title)}</h4>
        </div>
        <div class="formatted-content">${paragraphs}</div>
      </article>
    `;
  }).join("\n");

  return `<div class="output-field">${cards}</div>`;
}

export async function generateWithPersonalAI(args: {
  settings: JsonRecord;
  input: JsonRecord;
}): Promise<{ html: string; itemCount: number }> {
  const { settings, input } = args;

  const services = settings.services || {};
  const ai = services.aiModel || {};

  if (ai.enabled === false) {
    throw new Error(
      "The AI Model service is disabled. Enable it in this company's API settings.",
    );
  }

  const provider = normalizeProvider(ai.provider);
  const model = String(ai.model || "").trim();
  const encryptedKey = String(ai.apiKeyEncrypted || "");

  if (!["openai", "anthropic", "google", "groq"].includes(provider)) {
    throw new Error(
      "Choose OpenAI, Anthropic, Google Gemini or Groq in this company's AI Model settings.",
    );
  }

  if (!model) {
    throw new Error(
      "Choose an AI model in Profile → AI, API & content settings.",
    );
  }

  if (!encryptedKey.startsWith("enc:v1:")) {
    throw new Error(
      "No saved AI Model API key was found. Save the provider API key in this company's settings first.",
    );
  }

  const apiKey = decryptAiKey(encryptedKey);

  const platforms = Array.isArray(input.platforms)
    ? input.platforms.map((value: unknown) => String(value).trim()).filter(Boolean)
    : [];

  if (!platforms.length) {
    throw new Error("Select at least one content type before generating.");
  }

  const content = settings.content || {};

  const context = {
    company_name: input.company_name || "",
    company_website: input.company_website || "",
    company_summary: input.company_summary || "",
    company_details: input.company_details || "",
    company_research: input.company_research || "",
    target_audience: input.target_audience || "",
    product_or_service: input.product || "",
    content_goal: input.goal || "",
    brand_tone: input.tone || "",
    writing_style: input.style || "",
    additional_instructions: input.regenerate
      ? [
          input.extra || "",
          "Regeneration requested: produce substantially improved, original content.",
          `Previous content to improve:\n${String(input.previous_content || "").slice(0, 10000)}`,
        ].filter(Boolean).join("\n\n")
      : input.extra || "",
    selected_content_types: platforms,
    requested_counts: {
      social_media_posts: content.socialMediaPosts ?? 5,
      blog_word_count: content.blogWordCount ?? 1100,
      google_ad_copies: content.googleAdCopies ?? 3,
      meta_ad_copies: content.metaAdCopies ?? 3,
      email_messages: content.emailMessages ?? 3,
      whatsapp_messages: content.whatsappMessages ?? 2,
      sms_messages: content.smsMessages ?? 1,
      lead_followup_messages: content.leadFollowupMessages ?? 3,
    },
  };

  const prompt = `
You are a professional marketing content generator.

Use only the company facts provided. Never invent testimonials, customer results,
prices, certifications, or other unverified claims.

COUNT RULES (MANDATORY):
- For EACH selected social platform, generate exactly requested_counts.social_media_posts items with that platform as the channel.
- For Google Ads, Meta Ads, email, WhatsApp, SMS, and lead follow-ups, generate exactly the quantity specified for that type when it is selected.
- If Blog is selected, generate exactly one complete article as one item and respect requested_counts.blog_word_count.
- Never generate extra items. Return no introductory or closing text outside the JSON.
- Every item must have channel, title, and body. Use the exact selected platform/service name in channel.

Generate useful, polished content for every selected content type. For social media, create separate items for separate posts.

Return ONLY valid JSON with this exact structure:
{
  "items": [
    {
      "channel": "Instagram",
      "title": "Short descriptive title",
      "body": "Complete content"
    }
  ]
}

Do not include Markdown code fences or explanations outside the JSON.

COMPANY AND CONTENT REQUIREMENTS:
${JSON.stringify(context, null, 2)}
`.trim();

  let url: string;
  let headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  let requestBody: JsonRecord;

  if (provider === "openai" || provider === "groq") {
    url = provider === "groq"
      ? "https://api.groq.com/openai/v1/chat/completions"
      : "https://api.openai.com/v1/chat/completions";

    headers.Authorization = `Bearer ${apiKey}`;

    requestBody = {
      model,
      temperature: 0.7,
      messages: [
        {
          role: "system",
          content: "Return only valid JSON. Do not use Markdown fences.",
        },
        { role: "user", content: prompt },
      ],
    };
  } else if (provider === "anthropic") {
    url = "https://api.anthropic.com/v1/messages";
    headers["x-api-key"] = apiKey;
    headers["anthropic-version"] = "2023-06-01";

    requestBody = {
      model,
      max_tokens: 12000,
      messages: [{ role: "user", content: prompt }],
    };
  } else {
    url =
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent` +
      `?key=${encodeURIComponent(apiKey)}`;

    requestBody = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.7,
        responseMimeType: "application/json",
      },
    };
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(requestBody),
    cache: "no-store",
    signal: AbortSignal.timeout(240_000),
  });

  const rawResponse = await response.text();

  let providerResponse: JsonRecord = {};

  try {
    providerResponse = JSON.parse(rawResponse);
  } catch {
    // The error below intentionally avoids logging request headers or keys.
  }

  if (!response.ok) {
    const message =
      providerResponse.error?.message ||
      providerResponse.message ||
      `The provider returned HTTP ${response.status}.`;

    throw new Error(
      `${provider} generation failed: ${String(message).slice(0, 400)}`,
    );
  }

  const generatedText = extractText(provider, providerResponse);

  if (!generatedText.trim()) {
    throw new Error(
      `${provider} returned an empty response. Check the model name and API access.`,
    );
  }

  const items = parseGeneratedItems(generatedText);

  // Social output must match the configured count for every selected platform.
  // Fail clearly rather than silently showing the wrong number of posts.
  const socialPlatforms = platforms.filter((name: string) =>
    /instagram|facebook|linkedin|twitter|(^|\b)x(\b|$)|youtube/i.test(name),
  );
  const requestedSocialCount = Number(content.socialMediaPosts ?? 5);
  for (const platform of socialPlatforms) {
    const matching = items.filter((item) =>
      item.channel.toLowerCase().replace(/\s*\(.*?\)\s*/g, '').trim() === platform.toLowerCase().trim(),
    );
    if (matching.length !== requestedSocialCount) {
      throw new Error(
        `Your selected API returned ${matching.length} ${platform} posts; exactly ${requestedSocialCount} were requested. Please retry. No managed/platform AI fallback was used.`,
      );
    }
  }

  return {
    html: makeStudioHtml(items),
    itemCount: items.length,
  };
}
