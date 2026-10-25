import 'server-only';

/**
 * Optional n8n credential provisioning adapter. Provider credential schemas differ,
 * so mappings are explicit server configuration rather than guessed in code.
 */
export type CredentialProvisionResult = {
  status: 'created' | 'already_configured' | 'manual_required' | 'failed';
  name: string;
  credentialId?: string;
  credentialType?: string;
  message?: string;
};

function parseObjectEnv(name: string): Record<string, string> {
  const raw = process.env[name];
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  } catch {
    throw new Error(`${name} must be valid JSON containing string values.`);
  }
}

function slug(value: string) {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70) || 'Company';
}

export async function provisionN8nCredential(input: {
  companyName: string;
  serviceKey: string;
  provider: string;
  apiKey: string;
}): Promise<CredentialProvisionResult> {
  const name = `QASS — ${slug(input.companyName)} — ${input.serviceKey} — ${slug(input.provider)}`;
  const base = process.env.N8N_API_BASE_URL?.trim().replace(/\/+$/, '');
  const apiKey = process.env.N8N_API_KEY?.trim();
  const typeMap = parseObjectEnv('N8N_CREDENTIAL_TYPE_MAP');
  const fieldMap = parseObjectEnv('N8N_CREDENTIAL_FIELD_MAP');
  const mappingKey = `${input.serviceKey}:${input.provider.toLowerCase()}`;
  const credentialType = typeMap[mappingKey];

  if (!base || !apiKey || !credentialType) {
    return {
      status: 'manual_required', name, credentialType,
      message: !base || !apiKey
        ? 'n8n API access is not configured. Keep the encrypted Supabase key and create this credential manually in n8n.'
        : `No credential type mapping is configured for ${mappingKey}. Add it to N8N_CREDENTIAL_TYPE_MAP before enabling automatic provisioning.`,
    };
  }

  const fieldName = fieldMap[mappingKey] || 'apiKey';
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(fieldName)) {
    return { status: 'failed', name, credentialType, message: 'The configured credential field name is invalid.' };
  }

  try {
    const response = await fetch(`${base}/api/v1/credentials`, {
      method: 'POST',
      headers: { 'X-N8N-API-KEY': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ name, type: credentialType, data: { [fieldName]: input.apiKey } }),
      cache: 'no-store',
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { status: 'failed', name, credentialType, message: `n8n rejected credential provisioning (HTTP ${response.status}). Check the configured credential type and fields in n8n.` };
    }
    const credentialId = typeof payload.id === 'string' ? payload.id : undefined;
    if (!credentialId) {
      return { status: 'failed', name, credentialType, message: 'n8n did not return a credential ID; verify the credential in n8n before using it.' };
    }
    return { status: 'created', name, credentialType, credentialId, message: 'Credential created in n8n. Attach this credential ID to the correct provider node in the workflow before running live generation.' };
  } catch {
    return { status: 'failed', name, credentialType, message: 'Could not reach the n8n API. The key remains encrypted in Supabase; retry provisioning after checking server connectivity.' };
  }
}
