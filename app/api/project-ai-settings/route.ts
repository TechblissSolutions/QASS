import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient, getUserFromToken } from "@/lib/supabase";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { provisionN8nCredential } from "@/lib/n8n-credentials";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ApiMode = "platform" | "personal";
type ServiceKey = "aiModel" | "websiteAnalysis" | "research" | "mediaImage" | "mediaVideo";
const SERVICE_KEYS: ServiceKey[] = ["aiModel", "websiteAnalysis", "research", "mediaImage", "mediaVideo"];
const CONTENT_LIMITS: Record<string, [number, number]> = {
  socialMediaPosts: [1, 5], blogWordCount: [100, 5000], googleAdCopies: [1, 10], metaAdCopies: [1, 10],
  emailMessages: [1, 10], whatsappMessages: [1, 10], smsMessages: [1, 10], leadFollowupMessages: [1, 10],
  blogUniquenessThreshold: [0, 100], blogImageCount: [0, 5],
};
const CONTENT_DEFAULTS: Record<string, number> = {
  socialMediaPosts: 5, blogWordCount: 1100, googleAdCopies: 3, metaAdCopies: 3, emailMessages: 3,
  whatsappMessages: 2, smsMessages: 1, leadFollowupMessages: 3, blogUniquenessThreshold: 65, blogImageCount: 1,
};

type JsonRecord = Record<string, any>;
function encryptionKey() {
  const secret = process.env.API_CREDENTIALS_ENCRYPTION_KEY;
  if (!secret || secret.length < 32) throw new Error("Secure credential storage is not configured yet. Please try again later.");
  return createHash("sha256").update(secret).digest();
}
function encryptSecret(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `enc:v1:${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${encrypted.toString("base64")}`;
}
function getToken(req: NextRequest) {
  const authorization = req.headers.get("authorization")?.trim();
  if (!authorization) return undefined;
  return authorization.replace(/^Bearer\s+/i, "").trim();
}
async function getOwnedProject(req: NextRequest, projectId: string) {
  const token = getToken(req);
  if (!token) return { error: "Authentication required.", status: 401 as const };
  let user;
  try { user = await getUserFromToken(token); } catch { user = null; }
  if (!user) return { error: "Invalid session.", status: 401 as const };
  const supabase = getSupabaseClient(token);
  if (!supabase) return { error: "Supabase is not configured.", status: 503 as const };
  const { data: project, error } = await supabase.from("projects").select("id,url,profile").eq("id", projectId).eq("user_id", user.id).maybeSingle();
  if (error) return { error: "Unable to verify project ownership.", status: 500 as const };
  if (!project) return { error: "Project not found or access denied.", status: 404 as const };
  return { supabase, project };
}
function errorResponse(message: string, status = 500) { return NextResponse.json({ error: message }, { status }); }
function normalizeContent(rawContent: unknown, apiMode: ApiMode): Record<string, number> {
  const raw = rawContent && typeof rawContent === "object" ? rawContent as JsonRecord : {};
  const result: Record<string, number> = {};
  for (const [key, [min, max]] of Object.entries(CONTENT_LIMITS)) {
    let value = raw[key];
    // Upgrade legacy per-platform values to the single shared social-media quantity.
    if (key === "socialMediaPosts" && value === undefined) {
      const oldCounts = [raw.linkedinPosts, raw.instagramPosts, raw.facebookPosts, raw.xPosts, raw.youtubePosts]
        .map(Number).filter((n) => Number.isFinite(n));
      value = oldCounts.length ? Math.max(...oldCounts) : CONTENT_DEFAULTS[key];
    }
    const n = Number(value ?? CONTENT_DEFAULTS[key]);
    result[key] = Math.max(min, Math.min(max, Math.round(Number.isFinite(n) ? n : CONTENT_DEFAULTS[key])));
  }
  return result;
}
function safeSettings(legacy: JsonRecord) {
  const rawServices = legacy.services && typeof legacy.services === "object" ? legacy.services : {};
  const services: JsonRecord = {};
  for (const key of SERVICE_KEYS) {
    const row = rawServices[key] && typeof rawServices[key] === "object" ? rawServices[key] : {};
    const encrypted = typeof row.apiKeyEncrypted === "string" ? row.apiKeyEncrypted : "";
    services[key] = {
      provider: typeof row.provider === "string" ? row.provider : "",
      model: typeof row.model === "string" ? row.model : "",
      configured: encrypted.startsWith("enc:v1:"),
      enabled: row.enabled !== false,
      apiKey: "",
    };
  }
  return {
    apiMode: legacy.apiMode === "personal" ? "personal" : "platform",
    services,
    content: normalizeContent(legacy.content, legacy.apiMode === "personal" ? "personal" : "platform"),
  };
}

export async function GET(req: NextRequest) {
  try {
    const projectId = req.nextUrl.searchParams.get("projectId")?.trim();
    if (!projectId) return errorResponse("projectId is required.", 400);
    const owned = await getOwnedProject(req, projectId);
    if ("error" in owned) return errorResponse(typeof owned.error === "string" ? owned.error : "Unable to verify project ownership.", typeof owned.status === "number" ? owned.status : 500);
    const { data, error } = await owned.supabase.from("project_ai_settings")
      .select("api_mode, settings, updated_at").eq("project_id", projectId).maybeSingle();
    if (error) return errorResponse("Unable to load company settings from project_ai_settings.", 503);
    const legacy = data?.settings && typeof data.settings === "object" ? data.settings as JsonRecord : {};
    let override: string | null = null;
    const { data: policy, error: policyError } = await getSupabaseAdmin().from("admin_project_api_policies").select("api_mode_override").eq("project_id", projectId).maybeSingle();
    if (policyError) return errorResponse("Unable to verify administrator API-mode policy. Run the admin dashboard migration; settings were not exposed.", 503);
    override = policy?.api_mode_override ?? null;
    const combined = { ...legacy, apiMode: override || data?.api_mode || legacy.apiMode };
    return NextResponse.json({ settings: safeSettings(combined), apiModeOverride: override, updatedAt: data?.updated_at ?? null }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return errorResponse("Unable to load settings.");
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const projectId = typeof body.projectId === "string" ? body.projectId.trim() : "";
    const apiMode: ApiMode = body.apiMode;
    if (!projectId) return errorResponse("projectId is required.", 400);
    if (apiMode !== "platform" && apiMode !== "personal") return errorResponse("Invalid API mode.", 400);
    const owned = await getOwnedProject(req, projectId);
    if ("error" in owned) return errorResponse(typeof owned.error === "string" ? owned.error : "Unable to verify project ownership.", typeof owned.status === "number" ? owned.status : 500);
    const { data: policy, error: policyError } = await getSupabaseAdmin().from("admin_project_api_policies").select("api_mode_override").eq("project_id", projectId).maybeSingle();
    if (policyError) return errorResponse("Unable to verify administrator API-mode policy. Run the admin dashboard migration; settings were not changed.", 503);
    if (policy?.api_mode_override && policy.api_mode_override !== apiMode) return errorResponse(`An administrator has locked this company to ${policy.api_mode_override === "platform" ? "Our API (Sparrow)" : "Use My Own APIs"}. Contact your administrator to change this policy.`, 403);
    const { data: existing, error: readError } = await owned.supabase.from("project_ai_settings")
      .select("settings").eq("project_id", projectId).maybeSingle();
    if (readError) return errorResponse("Unable to read existing company settings.", 503);
    const oldSettings: JsonRecord = existing?.settings && typeof existing.settings === "object" ? existing.settings as JsonRecord : {};
    const oldServices: JsonRecord = oldSettings.services && typeof oldSettings.services === "object" ? oldSettings.services : {};
    const incomingServices: JsonRecord = body.services && typeof body.services === "object" ? body.services : {};
    const clearKeys = Array.isArray(body.clearKeys) ? body.clearKeys.filter((k: unknown): k is ServiceKey => typeof k === "string" && SERVICE_KEYS.includes(k as ServiceKey)) : [];
    const services: JsonRecord = {};
    const submittingKey = apiMode === "personal" && SERVICE_KEYS.some((key) => typeof incomingServices[key]?.apiKey === "string" && incomingServices[key].apiKey.trim().length > 0);
    if (submittingKey) { try { encryptionKey(); } catch (e) { return errorResponse(e instanceof Error ? e.message : "Secure credential storage is not configured.", 503); } }

    for (const key of SERVICE_KEYS) {
      const incoming = incomingServices[key] && typeof incomingServices[key] === "object" ? incomingServices[key] : {};
      const old = oldServices[key] && typeof oldServices[key] === "object" ? oldServices[key] : {};
      const apiKey = apiMode === "personal" && typeof incoming.apiKey === "string" ? incoming.apiKey.trim() : "";
      const provider = typeof incoming.provider === "string" ? incoming.provider.trim() : (typeof old.provider === "string" ? old.provider : "");
      const model = typeof incoming.model === "string" ? incoming.model.trim() : (typeof old.model === "string" ? old.model : "");
      if (provider.length > 80 || model.length > 160 || apiKey.length > 4096) return errorResponse(`Invalid configuration for ${key}.`, 400);
      let encrypted = typeof old.apiKeyEncrypted === "string" ? old.apiKeyEncrypted : "";
      if (clearKeys.includes(key)) encrypted = "";
      else if (apiKey) { try { encrypted = encryptSecret(apiKey); } catch { return errorResponse("Could not encrypt API credentials. Check server encryption configuration.", 503); } }
      services[key] = {
        provider, model, enabled: incoming.enabled !== false, apiKeyEncrypted: encrypted,
        ...(old.n8nCredential && typeof old.n8nCredential === "object" ? { n8nCredential: old.n8nCredential } : {}),
      };
    }

    const content = normalizeContent(body.content ?? oldSettings.content, apiMode);
    // Keep unrelated legacy fields for compatibility, while storing all API/content settings in one JSONB row.
    const settings = { ...oldSettings, apiMode, services, content };
    const now = new Date().toISOString();
    const { error: saveError } = await owned.supabase.from("project_ai_settings").upsert({
      project_id: projectId, api_mode: apiMode, settings, updated_at: now,
    }, { onConflict: "project_id" });
    if (saveError) return errorResponse("Unable to save settings in project_ai_settings. Check the table columns and project-owner RLS policies.", 503);

    // If the customer submitted a new API key, provision a company-named n8n credential
    // only when the server's n8n API and exact provider credential mapping are configured.
    // The key is never returned to the browser or included in logs.
    const profile = owned.project && typeof (owned.project as any).profile === "object" ? (owned.project as any).profile : {};
    const companyName = String(profile.company_name || profile.companyName || (owned.project as any).url || "Company").trim().slice(0, 120);
    let provisioningChanged = false;
    if (apiMode === "personal") {
      for (const key of SERVICE_KEYS) {
        const incoming = incomingServices[key] && typeof incomingServices[key] === "object" ? incomingServices[key] : {};
        const rawApiKey = typeof incoming.apiKey === "string" ? incoming.apiKey.trim() : "";
        if (!rawApiKey) continue;
        const provider = String(services[key]?.provider || "").trim();
        if (!provider) continue;
        const result = await provisionN8nCredential({ companyName, serviceKey: key, provider, apiKey: rawApiKey });
        services[key].n8nCredential = {
          status: result.status, name: result.name, credentialId: result.credentialId || null,
          credentialType: result.credentialType || null, message: result.message || null,
          updatedAt: new Date().toISOString(),
        };
        provisioningChanged = true;
      }
    }
    if (provisioningChanged) {
      const finalSettings = { ...settings, services };
      const { error: metadataError } = await owned.supabase.from("project_ai_settings").upsert({
        project_id: projectId, api_mode: apiMode, settings: finalSettings, updated_at: new Date().toISOString(),
      }, { onConflict: "project_id" });
      if (metadataError) return errorResponse("API settings were saved, but n8n provisioning status could not be saved. Check the project settings table before retrying.", 503);
      return NextResponse.json({ ok: true, settings: safeSettings(finalSettings), provisioning: SERVICE_KEYS.map((key) => ({ service: key, ...(services[key]?.n8nCredential || {}) })).filter((row) => row.status) }, { headers: { "Cache-Control": "private, no-store" } });
    }
    return NextResponse.json({ ok: true, settings: safeSettings(settings), provisioning: [] }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return errorResponse("Invalid request or unable to save settings.", 400);
  }
}
