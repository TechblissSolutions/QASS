const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const sourcePath = 'C:/Users/MSI-1/Downloads/TechBliss_Company_Content_Agent_with_Sparrow_Free_Trial.json';
const outputPath = path.resolve('n8n/TechBliss_Company_Content_Agent_Free_Trial_Updated.json');
const workflow = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
const byName = new Map(workflow.nodes.map((node) => [node.name, node]));
const getNode = (name) => {
  const node = byName.get(name);
  if (!node) throw new Error(`Required workflow node not found: ${name}`);
  return node;
};
const newId = () => crypto.randomUUID();
const pos = (node, x, y) => { node.position = [x, y]; return node; };

// Keep the export inactive until a dedicated server-to-server Header Auth
// credential has been selected in n8n.
workflow.active = false;

const validate = getNode('Validate Sparrow Trial Request');
validate.parameters.mode = 'runOnceForAllItems';
validate.parameters.jsCode = `const body = $json.body ?? $json;
const type = String(body.generation_type || '').trim().toLowerCase();
if (!['linkedin', 'blog'].includes(type)) throw new Error('generation_type must be linkedin or blog');
const clean = (value, max = 4000) => String(value ?? '').trim().slice(0, max);
const required = ['topic', 'target_audience', 'content_goal', 'brand_tone', 'writing_style'];
for (const key of required) if (!clean(body[key], 2000)) throw new Error('Missing required field: ' + key);
const topic = clean(body.topic, 1000);
const companySummary = clean(body.company_summary, 2000) || topic;
const companyDetails = clean(body.company_details, 4000) || clean(body.additional_instructions, 2000);
const research = clean(body.company_research, 4000) || [companySummary, companyDetails, 'Topic: ' + topic, 'Audience: ' + clean(body.target_audience, 1000)].filter(Boolean).join('\\n');
return [{json: {
  generation_type: type,
  topic,
  target_audience: clean(body.target_audience, 1000),
  content_goal: clean(body.content_goal, 100),
  brand_tone: clean(body.brand_tone, 40),
  writing_style: clean(body.writing_style, 150),
  content_style_inspiration: clean(body.content_style_inspiration || body.writing_style, 150),
  additional_instructions: clean(body.additional_instructions, 2000),
  keywords: clean(body.keywords, 1000),
  company_name: clean(body.company_name, 200) || 'Free Trial Visitor',
  company_website: clean(body.company_website, 500),
  company_summary: companySummary,
  company_details: companyDetails,
  company_research: research,
  product_or_service: clean(body.product_or_service, 1000) || topic,
  content_config: {social_post_count: 1, google_ad_count: 3, meta_ad_count: 3, email_count: 3, whatsapp_count: 2, sms_count: 1, followup_count: 3, blog_word_count: 180, blog_uniqueness_threshold: 65, blog_image_count: 1},
  output_token_limit: 1250,
  credits_cost: 50
}}];`;

const webhook = getNode('Sparrow Free Trial Webhook');
webhook.parameters.authentication = 'headerAuth';
webhook.notesInFlow = true;
webhook.notes = 'Server-to-server only. Select a dedicated Header Auth credential named Sparrow Free Trial Backend. Configure the Next.js server with the exact same header name and value using N8N_FREE_TRIAL_AUTH_HEADER and N8N_FREE_TRIAL_AUTH_VALUE. Never use a provider API credential here.';

const context = {
  id: newId(),
  name: 'Prepare Free Trial Company Context',
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [3020, 920],
  parameters: {mode: 'runOnceForAllItems', jsCode: `const request = $input.first().json || {};
const type = request.generation_type;
const config = {...request.content_config, social_post_count: 1, blog_word_count: 180};
const trial = {
  ...request,
  project_id: '00000000-0000-4000-8000-000000000001',
  n8n_session_id: 'trial_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8),
  free_trial: true,
  social_media_platforms: type === 'linkedin' ? ['LinkedIn'] : [],
  selected_content_types: type === 'linkedin' ? 'LinkedIn' : 'Blogs',
  content_config: config
};
return [{json: {...trial, body: trial, content_config: config}}];`},
  notesInFlow: true,
  notes: 'Maps anonymous trial fields to the existing company-content input shape and limits each requested package to one item.'
};
workflow.nodes.push(context);
byName.set(context.name, context);

// The main preparation node is shared. Make its optional brand lookup safe when
// The website-analysis branch did not run, without changing its normal inputs.
const companyPrep = getNode('Prepare Company Details');
companyPrep.parameters.jsCode = companyPrep.parameters.jsCode.replace(
  "let brandTheme = form.brand_theme || $('Extract Client Brand Theme').first().json.brand_theme || {};",
  "let extractedBrandTheme = {}; try { extractedBrandTheme = $('Extract Client Brand Theme').first().json.brand_theme || {}; } catch (e) {}\nlet brandTheme = form.brand_theme || extractedBrandTheme || {};"
);
if (companyPrep.parameters.jsCode.includes("let brandTheme = form.brand_theme || $('Extract Client Brand Theme').first().json.brand_theme || {};")) {
  throw new Error('Could not safely update Prepare Company Details brand-theme lookup.');
}

const connections = workflow.connections;
connections['Sparrow Free Trial Webhook'] = {main: [[{node: 'Validate Sparrow Trial Request', type: 'main', index: 0}]]};
connections['Validate Sparrow Trial Request'] = {main: [[{node: context.name, type: 'main', index: 0}]]};
connections[context.name] = {main: [[{node: 'Prepare Company Details', type: 'main', index: 0}]]};

// Route trial LinkedIn requests through a trial-only copy of the exact main
// social prompt and model family. Main LinkedIn nodes and settings are untouched.
const socialSource = getNode('Generate Social Media Content');
const socialModelSource = getNode('Ads and Messages, Blog And Videos');
const trialSocialModel = JSON.parse(JSON.stringify(socialModelSource));
trialSocialModel.id = newId();
trialSocialModel.name = 'Free Trial LinkedIn Groq Model';
trialSocialModel.position = [4880, 1420];
trialSocialModel.parameters.options = {...trialSocialModel.parameters.options, maxTokensToSample: 1250};
trialSocialModel.notesInFlow = true;
trialSocialModel.notes = 'Trial-only copy of the main social Groq model. Completion output is capped at 1,250 tokens.';
workflow.nodes.push(trialSocialModel);
byName.set(trialSocialModel.name, trialSocialModel);

const trialSocial = JSON.parse(JSON.stringify(socialSource));
trialSocial.id = newId();
trialSocial.name = 'Generate Free Trial LinkedIn Content';
trialSocial.position = [5160, 1420];
trialSocial.notesInFlow = true;
trialSocial.notes = 'Exact copied LinkedIn/social generation prompt from the main workflow. Uses trial context and the trial-only 1,250-token model.';
workflow.nodes.push(trialSocial);
byName.set(trialSocial.name, trialSocial);

const socialRouter = {
  id: newId(), name: 'Route Trial LinkedIn to Trial Model', type: 'n8n-nodes-base.if', typeVersion: 1,
  position: [4680, 1110],
  parameters: {conditions: {boolean: [{value1: "={{ $('Prepare Company Details').first().json.free_trial === true }}", value2: true}]}, options: {}},
  notesInFlow: true, notes: 'Trial LinkedIn requests use the isolated trial model; signed-in traffic keeps the original social model.'
};
workflow.nodes.push(socialRouter);
byName.set(socialRouter.name, socialRouter);
connections['Prepare Social Platforms'] = {main: [[{node: socialRouter.name, type: 'main', index: 0}]]};
connections[socialRouter.name] = {main: [
  [{node: trialSocial.name, type: 'main', index: 0}],
  [{node: 'Generate Social Media Content', type: 'main', index: 0}]
]};
trialSocial.onError = 'continueErrorOutput';
connections[trialSocial.name] = {main: [[{node: 'Prepare Sparrow Trial Response', type: 'main', index: 0}], [{node: 'Prepare Sparrow Trial Error Response', type: 'main', index: 0}]]};
connections[trialSocialModel.name] = {ai_languageModel: [[{node: trialSocial.name, type: 'ai_languageModel', index: 0}]]};

// Clone the complete Blog path so every model-backed step has a trial-specific
// output allowance. The six node caps add to exactly 1,250 completion tokens.
const blogNames = [
  'Prepare Blog Input', 'Blog Trend Research', 'Parse Blog Trend Data', 'Select Trending Blog Topic',
  'Parse Blog Outline', 'Draft Blog Article', 'Store Blog Draft', 'Fact-Check Blog',
  'Store Fact-Checked Blog', 'SEO Optimise Blog', 'Store SEO Blog', 'Blog Uniqueness Score',
  'Blog Uniqueness Gate', 'Rewrite Blog for Uniqueness', 'Store Final Blog',
  'Blog Quality Validation', 'Blog QC Gate', 'Fix Blog QC', 'Store QC Fixed Blog',
  'Revalidate Blog QC', 'Merge Final Blog', 'Final Blog Content Cleanup', 'Prepare Blog Preview Output'
];
const suffix = ' [Free Trial]';
const cloneName = (name) => name + suffix;
const nameMap = new Map(blogNames.map((name) => [name, cloneName(name)]));
const cloneNodeList = blogNames.map((name) => {
  const clone = JSON.parse(JSON.stringify(getNode(name)));
  clone.id = newId();
  clone.name = cloneName(name);
  clone.position = [clone.position[0] + 1500, clone.position[1] + 1500];
  clone.notesInFlow = true;
  clone.notes = 'Trial-only copy of the corresponding main Blog pipeline stage; the normal node remains unchanged.';
  const rewrite = (value) => {
    if (typeof value === 'string') {
      for (const [source, target] of nameMap) value = value.split(source).join(target);
      return value;
    }
    if (Array.isArray(value)) return value.map(rewrite);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, rewrite(entry)]));
    return value;
  };
  clone.parameters = rewrite(clone.parameters);
  clone.onError = 'continueErrorOutput';
  workflow.nodes.push(clone);
  byName.set(clone.name, clone);
  return clone;
});

const trialBlogBudgets = new Map([
  ['Select Trending Blog Topic', 200],
  ['Draft Blog Article', 300],
  ['Fact-Check Blog', 250],
  ['SEO Optimise Blog', 250],
  ['Rewrite Blog for Uniqueness', 125],
  ['Fix Blog QC', 125]
]);
if ([...trialBlogBudgets.values()].reduce((sum, value) => sum + value, 0) !== 1250) throw new Error('Trial Blog token allocations must sum to 1,250.');

for (const [sourceName, budget] of trialBlogBudgets) {
  const model = JSON.parse(JSON.stringify(getNode('Blogs')));
  model.id = newId();
  model.name = `Free Trial Blog Model — ${sourceName}`;
  model.position = [4860, 1840 + 130 * [...trialBlogBudgets.keys()].indexOf(sourceName)];
  model.parameters.options = {...model.parameters.options, maxTokensToSample: budget};
  model.notesInFlow = true;
  model.notes = `Trial-only Blog stage model. Its ${budget}-token output cap is part of the shared 1,250-token worst-case budget across all six model stages.`;
  workflow.nodes.push(model);
  byName.set(model.name, model);
  connections[model.name] = {ai_languageModel: [[{node: cloneName(sourceName), type: 'ai_languageModel', index: 0}]]};
}

const originalBlogConnections = workflow.connections;
for (const sourceName of blogNames) {
  const clone = getNode(cloneName(sourceName));
  const sourceConnection = originalBlogConnections[sourceName];
  if (!sourceConnection) continue;
  const copied = JSON.parse(JSON.stringify(sourceConnection));
  for (const outputType of Object.keys(copied)) {
    copied[outputType] = copied[outputType].map((group) => group
      .filter((edge) => nameMap.has(edge.node))
      .map((edge) => ({...edge, node: nameMap.get(edge.node)})));
  }
  connections[cloneName(sourceName)] = copied;
  if (clone.type !== 'n8n-nodes-base.if') {
    const outputs = connections[cloneName(sourceName)].main || [[]];
    while (outputs.length < 2) outputs.push([]);
    outputs[1].push({node: 'Prepare Sparrow Trial Error Response', type: 'main', index: 0});
    connections[cloneName(sourceName)].main = outputs;
  } else {
    const outputs = connections[cloneName(sourceName)].main || [[], []];
    while (outputs.length < 3) outputs.push([]);
    outputs[2].push({node: 'Prepare Sparrow Trial Error Response', type: 'main', index: 0});
    connections[cloneName(sourceName)].main = outputs;
  }
}

// Only send Blog trial submissions into the duplicated Blog graph. The normal
// graph still receives every signed-in request through its existing connection.
const blogRouter = {
  id: newId(), name: 'Route Free Trial Blog', type: 'n8n-nodes-base.if', typeVersion: 1,
  position: [4640, 1590],
  parameters: {conditions: {boolean: [{value1: "={{ $('Prepare Company Details').first().json.free_trial === true && $('Prepare Company Details').first().json.generation_type === 'blog' }}", value2: true}]}, options: {}},
  notesInFlow: true, notes: 'Only an anonymous Blog trial enters the full trial-only Blog graph.'
};
workflow.nodes.push(blogRouter);
byName.set(blogRouter.name, blogRouter);
connections['Combine Content Strategy'].main[0].push({node: blogRouter.name, type: 'main', index: 0});
connections[blogRouter.name] = {main: [[{node: cloneName('Prepare Blog Input'), type: 'main', index: 0}], []]};
connections[cloneName('Prepare Blog Preview Output')] = {main: [[{node: 'Prepare Sparrow Trial Response', type: 'main', index: 0}], [{node: 'Prepare Sparrow Trial Error Response', type: 'main', index: 0}]]};

// The main workflow always prepares Blog content; suppress that normal branch
// for trials, while leaving all signed-in Blog behavior unchanged.
const blogInput = getNode(cloneName('Prepare Blog Input'));
blogInput.parameters.jsCode = blogInput.parameters.jsCode.replace(
  "const incoming=$input.first().json||{};",
  "const incoming=$input.first().json||{};\nlet trialContext={}; try { trialContext=$('Prepare Company Details').first().json||{}; } catch(e) {}\nif (trialContext.free_trial === true && trialContext.generation_type !== 'blog') return [];"
);
blogInput.parameters.jsCode = blogInput.parameters.jsCode.replace(
  "const trendSearchQuery=[product,companyName,domain,'latest trends','industry news',String(new Date().getFullYear())].filter(Boolean).join(' ');",
  "const trialTopic=company.free_trial ? pick(company.topic,'') : '';\nconst trialKeywords=company.free_trial ? pick(company.keywords,'') : '';\nconst trendSearchQuery=[product,companyName,domain,trialTopic,trialKeywords,'latest trends','industry news',String(new Date().getFullYear())].filter(Boolean).join(' ');"
);
const mainBlogInput = getNode('Prepare Blog Input');
mainBlogInput.parameters.jsCode = mainBlogInput.parameters.jsCode.replace(
  "const incoming=$input.first().json||{};",
  "const incoming=$input.first().json||{};\nlet trialContext={}; try { trialContext=$('Prepare Company Details').first().json||{}; } catch(e) {}\nif (trialContext.free_trial === true) return [];"
);

// The shared strategy code fans out to website, ads, social and Blog. Route
// trial requests around all normal output branches so only the selected trial
// pipeline runs; the non-trial branch keeps all original outgoing connections.
const strategyRouter = {
  id: newId(), name: 'Route Free Trial Content Pipelines', type: 'n8n-nodes-base.if', typeVersion: 1,
  position: [4480, 930],
  parameters: {conditions: {boolean: [{value1: "={{ $('Prepare Company Details').first().json.free_trial === true }}", value2: true}]}, options: {}},
  notesInFlow: true, notes: 'Trial requests run only their chosen format through isolated trial model settings. Signed-in traffic continues to the original generation branches.'
};
workflow.nodes.push(strategyRouter);
byName.set(strategyRouter.name, strategyRouter);
const originalStrategyOutputs = connections['Combine Content Strategy'].main[0];
connections['Combine Content Strategy'] = {main: [[{node: strategyRouter.name, type: 'main', index: 0}]]};
connections[strategyRouter.name] = {main: [
  [
    {node: 'Prepare Social Platforms', type: 'main', index: 0},
    {node: blogRouter.name, type: 'main', index: 0}
  ],
  originalStrategyOutputs
]};

const oldTrial = getNode('Generate Sparrow Trial Content');
oldTrial.disabled = true;
oldTrial.notesInFlow = true;
oldTrial.notes = 'Retained for audit history; disconnected. Trial requests now use the main LinkedIn and full Blog pipelines.';
const oldTrialModel = getNode('Sparrow Trial Groq Model');
oldTrialModel.disabled = true;
oldTrialModel.notesInFlow = true;
oldTrialModel.notes = 'Retained for audit history; disconnected. Use the trial-only main-pipeline model nodes instead.';
connections['Validate Sparrow Trial Request'] = {main: [[{node: context.name, type: 'main', index: 0}]]};
delete connections['Generate Sparrow Trial Content'];
delete connections['Sparrow Trial Groq Model'];

const response = getNode('Prepare Sparrow Trial Response');
response.parameters.mode = 'runOnceForAllItems';
response.parameters.jsCode = `const item = $input.first()?.json ?? {};
const prepared = $('Prepare Company Details').first().json || {};
const type = prepared.generation_type;
const content = String(item.content ?? item.text ?? item.output ?? item.response ?? '').trim();
if (!['linkedin', 'blog'].includes(type)) throw new Error('The trial workflow could not identify the requested generation type.');
if (!content) throw new Error('Trial generation returned no content.');
if (type === 'blog') {
  const qc = item.qc_report || item.qcReport || {};
  const complete = /^#\\s+.+/m.test(content) && /^##\\s+.+/m.test(content) && /\\b(faq|frequently asked questions)\\b/i.test(content) && /^##[^\\n]*conclusion/im.test(content) && /[.!?)]\\s*$/.test(content);
  if (qc.passedQC !== true || !complete) throw new Error('The Blog could not complete all research, writing, fact-checking, SEO, uniqueness, and quality stages within its shared 1,250-token output budget. No incomplete article was returned.');
}
const modelNodes = type === 'linkedin'
  ? ['Generate Free Trial LinkedIn Content']
  : [
      'Select Trending Blog Topic [Free Trial]', 'Draft Blog Article [Free Trial]',
      'Fact-Check Blog [Free Trial]', 'SEO Optimise Blog [Free Trial]',
      'Rewrite Blog for Uniqueness [Free Trial]', 'Fix Blog QC [Free Trial]'
    ];
function safeOutputs(name) { try { return $(name).all().map((row) => row.json || {}); } catch (e) { return []; } }
function extractUsage(value) {
  if (!value || typeof value !== 'object') return null;
  const source = value.usage_metadata || value.tokenUsage || value.usage || value;
  if (!source || typeof source !== 'object') return null;
  const pick = (...keys) => { for (const key of keys) { const number = Number(source[key]); if (Number.isInteger(number) && number >= 0) return number; } return null; };
  const prompt = pick('prompt_tokens', 'promptTokens', 'input_tokens');
  const completion = pick('completion_tokens', 'completionTokens', 'output_tokens');
  const total = pick('total_tokens', 'totalTokens');
  return prompt === null && completion === null && total === null ? null : {prompt_tokens: prompt, completion_tokens: completion, total_tokens: total};
}
const reports = modelNodes.flatMap((name) => safeOutputs(name).map(extractUsage));
const usageAvailable = reports.length > 0 && reports.every(Boolean);
const usage = usageAvailable ? {
  prompt_tokens: reports.every((row) => row.prompt_tokens !== null) ? reports.reduce((sum, row) => sum + row.prompt_tokens, 0) : null,
  completion_tokens: reports.every((row) => row.completion_tokens !== null) ? reports.reduce((sum, row) => sum + row.completion_tokens, 0) : null,
  total_tokens: reports.every((row) => row.total_tokens !== null) ? reports.reduce((sum, row) => sum + row.total_tokens, 0) : null
} : {prompt_tokens: null, completion_tokens: null, total_tokens: null};
return [{json: {success: true, generation_type: type, content, credits_cost: 50, usage, usage_metadata_available: usageAvailable, ...(!usageAvailable ? {usage_limitation: 'The installed Groq/LangChain chain output did not expose complete provider token-usage metadata for every executed stage.'} : {})}}];`;
response.notesInFlow = true;
response.notes = 'Returns success only for complete content. Blog quality gates must pass. Usage is aggregated only from actual node/provider metadata; missing values remain null.';

const errorResponse = getNode('Prepare Sparrow Trial Error Response');
errorResponse.parameters.mode = 'runOnceForAllItems';
errorResponse.parameters.jsCode = `const item = $input.first()?.json ?? {};
const body = item.body && typeof item.body === 'object' ? item.body : item;
let type = body.generation_type === 'blog' ? 'blog' : 'linkedin'; try { type = $('Prepare Company Details').first().json.generation_type || type; } catch(e) {}
const message = String(item.error?.message ?? item.error ?? item.message ?? 'Trial generation failed before a complete result was produced.').slice(0, 500);
return [{json: {success: false, generation_type: type, error: message}}];`;

// The trial receiver stays authenticated; n8n will ask the importing operator
// to select a dedicated Header Auth credential before activation.
const respondSuccess = getNode('Respond Sparrow Trial');
respondSuccess.parameters.respondWith = 'json';
respondSuccess.parameters.responseBody = '={{ $json }}';
respondSuccess.parameters.options = {...respondSuccess.parameters.options, responseCode: 200};
const respondError = getNode('Respond Sparrow Trial Error');
respondError.parameters.respondWith = 'json';
respondError.parameters.responseBody = '={{ $json }}';
respondError.parameters.options = {...respondError.parameters.options, responseCode: 500};

// Trial request preparation and response exceptions use the existing structured
// error response path. Main pipeline nodes and prompts are left untouched.
validate.onError = 'continueErrorOutput';
connections['Validate Sparrow Trial Request'] = {main: [[{node: context.name, type: 'main', index: 0}], [{node: 'Prepare Sparrow Trial Error Response', type: 'main', index: 0}]]};
context.onError = 'continueErrorOutput';
connections[context.name] = {main: [[{node: 'Prepare Company Details', type: 'main', index: 0}], [{node: 'Prepare Sparrow Trial Error Response', type: 'main', index: 0}]]};
response.onError = 'continueErrorOutput';
connections['Prepare Sparrow Trial Response'] = {main: [[{node: 'Respond Sparrow Trial', type: 'main', index: 0}], [{node: 'Prepare Sparrow Trial Error Response', type: 'main', index: 0}]]};
connections['Prepare Sparrow Trial Error Response'] = {main: [[{node: 'Respond Sparrow Trial Error', type: 'main', index: 0}]]};

// Structural checks for the export: unique node IDs, valid connection targets,
// exact main prompt/model preservation, and the trial Blog aggregate cap.
const ids = workflow.nodes.map((node) => node.id);
if (new Set(ids).size !== ids.length) throw new Error('Workflow export contains duplicate node IDs.');
const allNames = new Set(workflow.nodes.map((node) => node.name));
for (const [source, outputs] of Object.entries(connections)) {
  if (!allNames.has(source)) throw new Error(`Connection source node is missing: ${source}`);
  for (const groups of Object.values(outputs)) for (const group of groups) for (const edge of group) {
    if (!allNames.has(edge.node)) throw new Error(`Connection target node is missing: ${edge.node}`);
  }
}
const originalWorkflow = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
const originalByName = new Map(originalWorkflow.nodes.map((node) => [node.name, node]));
for (const name of [
  'Generate Social Media Content', 'Select Trending Blog Topic', 'Draft Blog Article',
  'Fact-Check Blog', 'SEO Optimise Blog', 'Rewrite Blog for Uniqueness', 'Fix Blog QC',
  'Blogs', 'Ads and Messages, Blog And Videos'
]) {
  const current = getNode(name);
  const original = originalByName.get(name);
  if (JSON.stringify(current.parameters) !== JSON.stringify(original.parameters)) {
    throw new Error(`Normal generation prompt/model configuration changed unexpectedly: ${name}`);
  }
}
if ([...trialBlogBudgets.values()].reduce((sum, value) => sum + value, 0) !== 1250) throw new Error('Trial Blog aggregate model output cap is invalid.');

fs.mkdirSync(path.dirname(outputPath), {recursive: true});
fs.writeFileSync(outputPath, JSON.stringify(workflow, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({outputPath, nodeCount: workflow.nodes.length, blogTrialStageCaps: Object.fromEntries(trialBlogBudgets), blogTrialMaxOutputTokens: 1250, linkedinTrialMaxOutputTokens: 1250, active: workflow.active}, null, 2));
