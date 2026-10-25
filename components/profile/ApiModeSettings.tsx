"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase";

type ApiMode = "platform" | "personal";
type ServiceKey = "aiModel" | "websiteAnalysis" | "research" | "mediaImage" | "mediaVideo";
type ServiceConfig = { provider: string; model: string; apiKey: string; configured: boolean; enabled: boolean };
type Settings = {
  apiMode: ApiMode;
  services: Record<ServiceKey, ServiceConfig>;
  content: {
    socialMediaPosts: number; blogWordCount: number; googleAdCopies: number; metaAdCopies: number;
    emailMessages: number; whatsappMessages: number; smsMessages: number; leadFollowupMessages: number;
    blogUniquenessThreshold: number; blogImageCount: number;
  };
};

type Props = { projectId: string; initialMode?: ApiMode; companyUrl?: string; setupFlow?: boolean };
const providers: Record<ServiceKey, { label: string; options: { value: string; label: string; models?: string[] }[] }> = {
  aiModel: { label: "AI Model", options: [
    { value: "openai", label: "OpenAI", models: ["gpt-4.1", "gpt-4.1-mini", "gpt-4o", "gpt-4o-mini", "o3-mini"] },
    { value: "anthropic", label: "Anthropic Claude", models: ["claude-sonnet-4-20250514", "claude-3-7-sonnet-latest", "claude-3-5-haiku-latest"] },
    { value: "google", label: "Google Gemini", models: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.0-flash"] },
    { value: "groq", label: "Groq", models: ["openai/gpt-oss-20b", "llama-3.3-70b-versatile"] },
  ] },
  websiteAnalysis: { label: "Website Analysis", options: [
    { value: "jina", label: "Jina Reader", models: ["Reader API"] },
    { value: "firecrawl", label: "Firecrawl", models: ["Scrape API", "Crawl API"] },
    { value: "browserless", label: "Browserless", models: ["Browser API"] },
  ] },
  research: { label: "Research", options: [
    { value: "serper", label: "Serper", models: ["Google Search API"] },
    { value: "tavily", label: "Tavily", models: ["Search API", "Research API"] },
    { value: "exa", label: "Exa", models: ["Search API"] },
  ] },
  mediaImage: { label: "Image Generation", options: [
    { value: "openai", label: "OpenAI Images", models: ["gpt-image-1", "dall-e-3"] },
    { value: "google", label: "Google Imagen", models: ["imagen-3.0-generate-002"] },
    { value: "replicate", label: "Replicate", models: ["Provider/model endpoint"] },
  ] },
  mediaVideo: { label: "Video Generation", options: [
    { value: "runway", label: "Runway", models: ["Gen-3 Alpha", "Gen-4"] },
    { value: "google", label: "Google Veo", models: ["veo-2.0-generate-001"] },
    { value: "replicate", label: "Replicate", models: ["Provider/model endpoint"] },
  ] },
};
const defaultSettings: Settings = {
  apiMode: "platform",
  services: {
    aiModel: { provider: "openai", model: "gpt-4.1-mini", apiKey: "", configured: false, enabled: true },
    websiteAnalysis: { provider: "jina", model: "Reader API", apiKey: "", configured: false, enabled: true },
    research: { provider: "serper", model: "Google Search API", apiKey: "", configured: false, enabled: true },
    mediaImage: { provider: "openai", model: "gpt-image-1", apiKey: "", configured: false, enabled: true },
    mediaVideo: { provider: "runway", model: "Gen-3 Alpha", apiKey: "", configured: false, enabled: true },
  },
  content: {
    socialMediaPosts: 5, blogWordCount: 1100, googleAdCopies: 3, metaAdCopies: 3, emailMessages: 3,
    whatsappMessages: 2, smsMessages: 1, leadFollowupMessages: 3,
    blogUniquenessThreshold: 65, blogImageCount: 1,
  },
};
const serviceKeys: ServiceKey[] = ["aiModel", "websiteAnalysis", "research", "mediaImage", "mediaVideo"];
const quantityFields: { key: keyof Settings["content"]; label: string; min: number; max: number }[] = [
  { key: "socialMediaPosts", label: "Social media posts (all connected platforms)", min: 1, max: 5 },
  { key: "blogWordCount", label: "Blog word count", min: 100, max: 5000 },
  { key: "googleAdCopies", label: "Google ad copies", min: 1, max: 10 },
  { key: "metaAdCopies", label: "Meta ad copies", min: 1, max: 10 },
  { key: "emailMessages", label: "Email messages", min: 1, max: 10 },
  { key: "whatsappMessages", label: "WhatsApp messages", min: 1, max: 10 },
  { key: "smsMessages", label: "SMS messages", min: 1, max: 10 },
  { key: "leadFollowupMessages", label: "Lead follow-up messages", min: 1, max: 10 },
  { key: "blogUniquenessThreshold", label: "Blog uniqueness threshold (%)", min: 0, max: 100 },
  { key: "blogImageCount", label: "Blog image count", min: 0, max: 5 },
];

function EyeIcon({ visible }: { visible: boolean }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {visible ? <><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.7"/></> : <><path d="M3 3l18 18"/><path d="M10.6 10.6a2 2 0 0 0 2.8 2.8"/><path d="M9.9 5.2A10.7 10.7 0 0 1 12 5c5.2 0 8.8 4.6 9.5 6-.3.7-1.5 2.4-3.5 3.8"/><path d="M6.2 6.2C4.1 7.6 2.8 9.7 2.5 11c.7 1.4 4.3 6 9.5 6 1 0 1.9-.2 2.8-.5"/></>}
  </svg>;
}

export default function ApiModeSettings({ projectId, initialMode, companyUrl, setupFlow }: Props) {
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [messageTarget, setMessageTarget] = useState<string>("load");
  const [visibleKeys, setVisibleKeys] = useState<ServiceKey[]>([]);
  const [connectingService, setConnectingService] = useState<ServiceKey | null>(null);

  const request = useCallback(async (method: "GET" | "PUT", payload?: unknown) => {
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error("Supabase is not configured.");
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error("Please sign in again.");
    const response = await fetch(method === "GET" ? `/api/project-ai-settings?projectId=${encodeURIComponent(projectId)}` : "/api/project-ai-settings", {
      method, headers: { Authorization: `Bearer ${session.access_token}`, ...(payload ? { "Content-Type": "application/json" } : {}) },
      ...(payload ? { body: JSON.stringify(payload) } : {}), cache: "no-store",
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Request failed.");
    return result;
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setMessage(""); setMessageTarget("load");
      try {
        const result = await request("GET");
        if (!cancelled) {
          const incoming = result.settings || {};
          const mergedServices = { ...defaultSettings.services, ...(incoming.services || {}) } as Settings["services"];
          for (const key of serviceKeys) mergedServices[key] = { ...defaultSettings.services[key], ...(incoming.services?.[key] || {}), apiKey: "" };
          setSettings({ ...defaultSettings, ...incoming, apiMode: initialMode || incoming.apiMode || defaultSettings.apiMode, services: mergedServices, content: { ...defaultSettings.content, ...(incoming.content || {}) } });
        }
      } catch (e) { if (!cancelled) { setError(true); setMessage(e instanceof Error ? e.message : "Unable to load settings."); setMessageTarget("load"); } }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [request, initialMode]);

  function updateService(key: ServiceKey, patch: Partial<ServiceConfig>) {
    setSettings(s => ({ ...s, services: { ...s.services, [key]: { ...s.services[key], ...patch } } }));
    setMessage(""); setMessageTarget("");
  }
  function updateProvider(key: ServiceKey, provider: string) {
    const model = providers[key].options.find(o => o.value.trim() === provider)?.models?.[0] || "";
    updateService(key, { provider: provider.trim(), model });
  }
  function updateContent(key: keyof Settings["content"], value: number) {
    const spec = quantityFields.find(f => f.key === key)!;
    const bounded = Math.max(spec.min, Math.min(spec.max, Number.isFinite(value) ? Math.round(value) : spec.min));
    setSettings(s => ({ ...s, content: { ...s.content, [key]: bounded } }));
  }
  async function save() {
  setSaving(true);
  setMessage("");
  setMessageTarget("content");

  try {
    const result = await request("PUT", {
      projectId,
      apiMode: settings.apiMode,
      services: settings.services,
      content: settings.content,
    });

    setSettings((current) => ({
      ...current,
      apiMode: result.settings?.apiMode ?? current.apiMode,
      services: Object.fromEntries(
        serviceKeys.map((key) => [
          key,
          {
            ...current.services[key],
            apiKey: "",
            configured:
              result.settings?.services?.[key]?.configured ??
              current.services[key].configured,
          },
        ]),
      ) as Settings["services"],
      content: {
        ...current.content,
        ...(result.settings?.content ?? current.content),
      },
    }));

    setError(false);
    setMessage("Settings saved for this company.");
    setMessageTarget("content");
  } catch (e) {
    setError(true);
    setMessage(
      e instanceof Error ? e.message : "Unable to save settings.",
    );
    setMessageTarget("content");
  } finally {
    setSaving(false);
  }
}

  async function connectService(key: ServiceKey) {
    setConnectingService(key); setMessage(""); setMessageTarget(key);
    try {
      const result = await request("PUT", { projectId, apiMode: "personal", services: settings.services, content: settings.content });
      setSettings(s => ({ ...s, apiMode: "personal", services: Object.fromEntries(serviceKeys.map(k => [k, { ...s.services[k], apiKey: "", configured: result.settings?.services?.[k]?.configured ?? s.services[k].configured }])) as Settings["services"] }));
      setError(false); setMessage(`${providers[key].label} credentials saved. Provider connectivity has not been verified by a live API test.`); setMessageTarget(key);
    } catch (e) { setError(true); setMessage(e instanceof Error ? e.message : `Unable to save ${providers[key].label} credentials.`); setMessageTarget(key); }
    finally { setConnectingService(null); }
  }

  async function removeService(key: ServiceKey) {
    setConnectingService(key); setMessage(""); setMessageTarget(key);
    try {
      const result = await request("PUT", {
        projectId,
        apiMode: "personal",
        services: settings.services,
        content: settings.content,
        clearKeys: [key],
      });
      setSettings(s => ({
        ...s,
        apiMode: "personal",
        services: Object.fromEntries(serviceKeys.map(k => [k, {
          ...s.services[k],
          apiKey: "",
          configured: k === key ? false : (result.settings?.services?.[k]?.configured ?? s.services[k].configured),
        }])) as Settings["services"],
      }));
      setError(false); setMessage(""); setMessageTarget(key);
    } catch (e) {
      setError(true); setMessage(e instanceof Error ? e.message : `Unable to remove ${providers[key].label} credentials.`); setMessageTarget(key);
    } finally { setConnectingService(null); }
  }

  const personal = settings.apiMode === "personal";
  return <section className="api-settings">
    <div className="api-settings__heading"><div className="api-settings__icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6 5.6 18.4"/></svg></div><div><p className="api-settings__eyebrow">COMPANY CONFIGURATION</p><h3>AI, API & content settings</h3><p className="api-settings__description">Configure this company’s AI services and content defaults.</p></div></div>
    {!loading && messageTarget === "load" && message && <p className={`api-settings__message ${error ? "is-error" : "is-info"}`} role={error ? "alert" : "status"}>{message}</p>}
    {loading ? <p className="api-settings__loading">Loading company settings…</p> : <>
      <div className="api-settings__options" role="radiogroup" aria-label="API mode">
        <button type="button" role="radio" aria-checked={!personal} className={`api-settings__option ${!personal ? "is-selected" : ""}`} onClick={() => setSettings(s => ({ ...s, apiMode: "platform" }))}><span className="api-settings__option-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M7 7h10M7 12h10M7 17h10"/><path d="M4 4h16v16H4z"/></svg></span><span className="api-settings__option-copy"><strong>Use Our API</strong><span>Generate through the platform API workflow.</span></span><span className="api-settings__radio" /></button>
        <button type="button" role="radio" aria-checked={personal} className={`api-settings__option ${personal ? "is-selected" : ""}`} onClick={() => setSettings(s => ({ ...s, apiMode: "personal" }))}><span className="api-settings__option-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 12h8M12 8v8"/></svg></span><span className="api-settings__option-copy"><strong>Use My Own APIs</strong><span>Generate with this company's saved provider and API key. No platform AI fallback.</span></span><span className="api-settings__radio" /></button>
      </div>
      {personal && <>
        <div className="api-settings__service-grid">
          {(["aiModel", "websiteAnalysis", "research", "mediaImage"] as ServiceKey[]).map((key) => {
            const renderServiceFields = (serviceKey: ServiceKey) => {
              const config = settings.services[serviceKey];
              const service = providers[serviceKey];
              const selectedProvider = service.options.find(o => o.value.trim() === config.provider);
              const models = selectedProvider?.models || ["Provider-specific endpoint"];
              return <div className="api-settings__service-fields" key={serviceKey}>
                {serviceKey === "mediaVideo" && <h5 className="api-settings__media-subheading">Video generation</h5>}
                {serviceKey === "mediaImage" && <h5 className="api-settings__media-subheading">Image generation</h5>}
                <div className="api-settings__service-title"><div><span className="api-settings__eyebrow">{serviceKey === "mediaImage" || serviceKey === "mediaVideo" ? "MEDIA PROVIDER" : "SERVICE CONFIGURATION"}</span>{serviceKey !== "mediaImage" && serviceKey !== "mediaVideo" && <h4>{service.label}</h4>}</div><span className={`api-settings__status ${config.configured ? "is-connected" : "is-missing"}`}>{config.configured ? "Key saved · not tested" : "Not connected"}</span></div>
                <label className="api-settings__label">Provider<select className="api-settings__input" value={config.provider} onChange={e => updateProvider(serviceKey, e.target.value)}>{service.options.map(o => <option value={o.value.trim()} key={o.value}>{o.label}</option>)}</select></label>
                <label className="api-settings__label">Model / service<select className="api-settings__input" value={config.model} onChange={e => updateService(serviceKey, { model: e.target.value })}>{models.map(m => <option key={m} value={m}>{m}</option>)}</select></label>
                <label className="api-settings__label">API key<div className="api-settings__secret-row"><input className="api-settings__input" type={visibleKeys.includes(serviceKey) ? "text" : "password"} autoComplete="new-password" placeholder={config.configured ? "••••••••••••••••  ·  Saved key" : "Paste API key"} value={config.apiKey} onChange={e => updateService(serviceKey, { apiKey: e.target.value })} /><button className="api-settings__eye" type="button" aria-label={visibleKeys.includes(serviceKey) ? "Hide API key" : "Show API key"} title={visibleKeys.includes(serviceKey) ? "Hide API key" : "Show API key"} onClick={() => setVisibleKeys(old => old.includes(serviceKey) ? old.filter(k => k !== serviceKey) : [...old, serviceKey])}><EyeIcon visible={visibleKeys.includes(serviceKey)} /></button></div></label>
                <div className="api-settings__service-actions">
                  {!config.configured || config.apiKey.trim() ? <button type="button" className="api-settings__connect" onClick={() => void connectService(serviceKey)} disabled={!!connectingService || !config.apiKey.trim()}>{connectingService === serviceKey ? "Connecting…" : config.configured ? "Update API key" : "Connect service"}</button> : null}
                  {config.configured && <button type="button" className="api-settings__remove" onClick={() => { if (window.confirm(`Remove the saved ${service.label} API key?`)) void removeService(serviceKey); }} disabled={!!connectingService}>{connectingService === serviceKey ? "Removing…" : "Remove"}</button>}
                </div>
                {message && messageTarget === serviceKey && <p className={`api-settings__message api-settings__action-message ${error ? "is-error" : "is-info"}`} role={error ? "alert" : "status"}>{message}</p>}
              </div>;
            };
            if (key === "mediaImage") return <article className="api-settings__service" key="mediaGeneration"><div className="api-settings__service-title"><div><span className="api-settings__eyebrow">SERVICE CONFIGURATION</span><h4>Media Generation</h4></div></div>{renderServiceFields("mediaImage")}<div className="api-settings__media-divider" />{renderServiceFields("mediaVideo")}</article>;
            return <article className="api-settings__service" key={key}>{renderServiceFields(key)}</article>;
          })}
        </div>
      </>}
      <div className="api-settings__subheading"><div><span className="api-settings__eyebrow">CONTENT DEFAULTS</span><h4>Content Generation Counts</h4><p>These counts apply to both Use Our API and Use My Own APIs. Social post count is applied to each selected social platform, matching the n8n workflow’s content-generation rules.</p></div></div>
      <div className="api-settings__quantity-grid">{quantityFields.map(field => <label className="api-settings__label" key={field.key}>{field.label}{field.max === 5 && field.key.toLowerCase().includes('posts') ? ` (max ${field.max})` : field.key === "blogWordCount" ? "" : ""}<input className="api-settings__input" type="number" min={field.min} max={field.max} step={1} value={settings.content[field.key]} onChange={e => updateContent(field.key, Number(e.target.value))} /></label>)}</div>
      <div className="api-settings__footer"><div className="api-settings__save-group"><button type="button" onClick={() => void save()} disabled={saving}>{saving ? "Saving…" : "Save API mode & content counts"}</button>{message && messageTarget === "content" && <p className={`api-settings__message api-settings__action-message ${error ? "is-error" : "is-info"}`} role={error ? "alert" : "status"}>{message}</p>}</div>{personal && setupFlow && <button type="button" className="api-settings__continue" onClick={() => { window.location.href = `/analyse?new=1&url=${encodeURIComponent(companyUrl || "")}&project=${encodeURIComponent(projectId)}`; }}>Continue to social accounts →</button>}</div>
    </>}
  </section>;
}
