import type { Agent, ModelTokenUsage } from './types';

export const PRICING_VERIFIED_AT = '2026-09-16';
export const PRICING_SOURCES = ['https://developers.openai.com/api/docs/pricing','https://platform.claude.com/docs/en/about-claude/pricing','https://docs.x.ai/developers/pricing'];
type Rate = { vendor:string; input:number; read:number; write?:number; write1h?:number; output:number; threshold?:number; thresholdInclusive?:boolean; long?:{input:number;read:number;write:number;write1h?:number;output:number} };
const rates:Record<string,Rate> = {};
function openai(model:string,input:number,output:number) {
  rates[model]={vendor:'openai',input,read:input/10,write:input*1.25,output,threshold:272000,long:{input:input*2,read:input/5,write:input*2.5,output:output*1.5}};
}
openai('gpt-6-astra',10,50);
openai('gpt-5.6-sol',4,20);
openai('gpt-5.6-terra',2,12);
openai('gpt-5.6-luna',0.2,1.2);
rates['gpt-5.5']={vendor:'openai',input:5,read:.5,output:30,threshold:272000,long:{input:10,read:1,write:0,output:45}};
rates['gpt-5.5-2026-04-23']=rates['gpt-5.5'];
for (const [model,input,output] of [
  ['claude-fable-5',10,50],['claude-opus-5',5,25],['claude-sonnet-5',2,10],['claude-haiku-4-5-20251001',1,5],
] as const) rates[model]={vendor:'anthropic',input,read:input*.1,write:input*1.25,write1h:input*2,output};
// Newer Claude models read cache below the usual 0.1x of input.
for (const [model,input,read,output] of [
  ['claude-fable-5-1',10,.25,50],['claude-opus-5-5',4,.2,20],['claude-sonnet-5-5',2,.1,10],
] as const) rates[model]={vendor:'anthropic',input,read,write:input*1.25,write1h:input*2,output};
rates['claude-haiku-5-5']={vendor:'anthropic',input:.1,read:.01,write:.125,write1h:.2,output:.5,threshold:100000,long:{input:.5,read:.05,write:.625,write1h:1,output:2.5}};
for (const [model,read] of [['grok-4.6',.5],['grok-4.5',.3]] as const) rates[model]={vendor:'xai',input:2,read,output:6,threshold:200000,thresholdInclusive:true,long:{input:4,read:read*2,write:0,output:12}};


export interface CostEstimate { usd:number|null; knownUsd:number; complete:boolean; unpricedTokens:number; notes:string[] }
function priceUsage(usage:ModelTokenUsage): {usd:number|null;note?:string} {
  const rate=rates[usage.model];
  if(!rate) return {usd:null,note:`No verified price for ${usage.model || 'unknown model'}.`};
  if(usage.provider && ![rate.vendor,`${rate.vendor}-codex`,`${rate.vendor}-responses`,`${rate.vendor}-completions`, ...(rate.vendor==='xai'?['xai-oauth']:[])].includes(usage.provider.toLowerCase())) return {usd:null,note:`Unverified billing route: ${usage.provider}.`};
  const values=[usage.inputTokens,usage.outputTokens,usage.cacheReadTokens,usage.cacheWriteTokens,usage.cacheWrite5mTokens,usage.cacheWrite1hTokens].filter(v=>v!==undefined);
  if(values.some(v=>!Number.isFinite(v)||(v ?? 0)<0)) return {usd:null,note:'Invalid token counters.'};
  if(usage.inputTokens && (usage.cacheReadTokens===undefined || usage.cacheWriteTokens===undefined)) return {usd:null,note:`Cache accounting is unavailable for ${usage.model}.`};
  let selected:Rate=rate;
  if(rate.threshold && usage.requestInputTokens===undefined && usage.inputTokens>=rate.threshold) return {usd:null,note:`Per-request context size is unavailable for ${usage.model}.`};
  if(rate.threshold && ((usage.requestInputTokens??usage.inputTokens)>rate.threshold || (rate.thresholdInclusive && (usage.requestInputTokens??usage.inputTokens)===rate.threshold)) && rate.long) selected={...rate,...rate.long};
  const read=usage.cacheReadTokens??0, write=usage.cacheWriteTokens??0;
  if(read+write>usage.inputTokens) return {usd:null,note:'Cached tokens exceed input total.'};
  if(write && rate.write===undefined) return {usd:null,note:`Cache-write price unavailable for ${usage.model}.`};
  let writeCost=write*(selected.write??0);
  if(write && selected.write===undefined) return {usd:null,note:`Cache-write price unavailable for ${usage.model}.`};
  if(write && selected.write1h!==undefined) {
    const short=usage.cacheWrite5mTokens, long=usage.cacheWrite1hTokens;
    if(short===undefined || long===undefined || short+long!==write) return {usd:null,note:`Cache-write lifetime is unavailable for ${usage.model}.`};
    writeCost=short*selected.write!+long*selected.write1h;
  }
  const tier=usage.serviceTier?.toLowerCase();
  let multiplier=1;
  if(tier && !['default','standard','auto'].includes(tier)) {
    if(usage.model.startsWith('gpt-5.5')) return {usd:null,note:`Service-tier pricing is unverified for ${usage.model}.`};
    if(['openai','xai'].includes(rate.vendor) && ['priority','fast'].includes(tier)) multiplier=2;
    else if(rate.vendor==='openai' && ['flex','batch'].includes(tier)) multiplier=.5;
    else return {usd:null,note:`Unverified service tier: ${tier}.`};
  }
  return {usd:((usage.inputTokens-read-write)*selected.input+read*selected.read+writeCost+usage.outputTokens*selected.output)*multiplier/1e6};
}

/** Current API token-value estimate, never a subscription invoice or historical charge. */
export function estimateAgentCost(agent:Agent):CostEstimate {
  const total=agent.stats.inputTokens+agent.stats.outputTokens;
  if(!total) return {usd:0,knownUsd:0,complete:true,unpricedTokens:0,notes:[]};
  let knownUsd=0,unpricedTokens=0,coveredInput=0,coveredOutput=0;
  const notes=new Set<string>();
  for(const usage of agent.tokenUsage??[]) {
    coveredInput+=usage.inputTokens; coveredOutput+=usage.outputTokens;
    const result=priceUsage(usage);
    if(result.usd===null) {unpricedTokens+=usage.inputTokens+usage.outputTokens; if(result.note) notes.add(result.note);}
    else knownUsd+=result.usd;
  }
  const missing=Math.max(0,agent.stats.inputTokens-coveredInput)+Math.max(0,agent.stats.outputTokens-coveredOutput);
  if(missing) {unpricedTokens+=missing;notes.add('Some tokens have no model/cache attribution.');}
  if(coveredInput>agent.stats.inputTokens || coveredOutput>agent.stats.outputTokens) return {usd:null,knownUsd:0,complete:false,unpricedTokens:total,notes:['Usage buckets exceed the recorded total.']};
  const complete=unpricedTokens===0;
  return {usd:complete?knownUsd:null,knownUsd,complete,unpricedTokens,notes:[...notes]};
}

export interface ModelCostRow {
  model: string;
  agents: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  knownUsd: number;
  unpricedTokens: number;
  /** Every token in this row has a verified price. */
  complete: boolean;
  /** List price in USD per 1M tokens, when the model has a verified rate. */
  rate?: { input: number; output: number };
  notes: string[];
}

/** Label for tokens an agent recorded without a model/cache bucket. */
export const UNATTRIBUTED_MODEL = 'Unattributed';

/**
 * Aggregates token usage and API token-value estimates per model across agents,
 * applying the same rules as `estimateAgentCost` so the rows sum to the run total.
 */
export function estimateModelCosts(agents: readonly Agent[]): ModelCostRow[] {
  const rows = new Map<string, ModelCostRow & { agentIds: Set<string> }>();
  const rowFor = (model: string) => {
    let row = rows.get(model);
    if (!row) {
      const rate = rates[model];
      row = { model, agents: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, knownUsd: 0, unpricedTokens: 0, complete: true, notes: [], agentIds: new Set(),
        ...(rate ? { rate: { input: rate.input, output: rate.output } } : {}) };
      rows.set(model, row);
    }
    return row;
  };
  for (const agent of agents) {
    const usages = agent.tokenUsage ?? [];
    const coveredInput = usages.reduce((sum, usage) => sum + usage.inputTokens, 0);
    const coveredOutput = usages.reduce((sum, usage) => sum + usage.outputTokens, 0);
    const exceeds = coveredInput > agent.stats.inputTokens || coveredOutput > agent.stats.outputTokens;
    if (exceeds) {
      // Matches estimateAgentCost: inconsistent buckets are never priced.
      const row = rowFor(UNATTRIBUTED_MODEL);
      row.agentIds.add(agent.id);
      row.inputTokens += agent.stats.inputTokens;
      row.outputTokens += agent.stats.outputTokens;
      row.unpricedTokens += agent.stats.inputTokens + agent.stats.outputTokens;
      row.notes.push('Usage buckets exceed the recorded total.');
      continue;
    }
    for (const usage of usages) {
      const row = rowFor(usage.model || UNATTRIBUTED_MODEL);
      row.agentIds.add(agent.id);
      row.inputTokens += usage.inputTokens;
      row.outputTokens += usage.outputTokens;
      row.cacheReadTokens += usage.cacheReadTokens ?? 0;
      const result = priceUsage(usage);
      if (result.usd === null) {
        row.unpricedTokens += usage.inputTokens + usage.outputTokens;
        if (result.note) row.notes.push(result.note);
      } else row.knownUsd += result.usd;
    }
    const missingInput = Math.max(0, agent.stats.inputTokens - coveredInput);
    const missingOutput = Math.max(0, agent.stats.outputTokens - coveredOutput);
    if (missingInput || missingOutput) {
      const row = rowFor(UNATTRIBUTED_MODEL);
      row.agentIds.add(agent.id);
      row.inputTokens += missingInput;
      row.outputTokens += missingOutput;
      row.unpricedTokens += missingInput + missingOutput;
      row.notes.push('Some tokens have no model/cache attribution.');
    }
  }
  return [...rows.values()]
    .map(({ agentIds, ...row }) => ({ ...row, agents: agentIds.size, complete: row.unpricedTokens === 0, notes: [...new Set(row.notes)] }))
    .filter((row) => row.inputTokens + row.outputTokens > 0)
    .sort((a, b) => b.knownUsd - a.knownUsd || (b.inputTokens + b.outputTokens) - (a.inputTokens + a.outputTokens) || a.model.localeCompare(b.model));
}
