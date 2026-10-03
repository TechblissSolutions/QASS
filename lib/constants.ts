export const PLATFORMS = ['Instagram', 'Facebook', 'LinkedIn', 'X/Twitter', 'YouTube'] as const;
export const STYLES = ['Seth Godin','Alex Hormozi','Gary Vaynerchuk','Dan Kennedy','Russell Brunson','Tony Robbins','Grant Cardone','Jordan Belfort'] as const;
export const SEC_META = [{key:'website',name:'Website and SEO'},{key:'social',name:'Social media'},{key:'ads',name:'Ads and messages'},{key:'blogs',name:'Blogs and video'}] as const;
const COLORS: Record<string,[string,string]> = {
  'Instagram':['#e11d48','#fff1f2'],
  'Facebook':['#2563eb','#eff6ff'],
  'LinkedIn':['#0a66c2','#eff6ff'],
  'X/Twitter':['#0a0a0a','#f5f5f5'],
  'YouTube':['#dc2626','#fef2f2'],
  'Website':['#7c3aed','#f5f3ff'],
  'Social':['#0a0a0a','#f5f5f5'],
  'Ads & messaging':['#b45309','#fffbeb'],
  'Blog & video':['#0d9488','#f0fdfa']
};
export function colorFor(ch: string): [string,string] { return COLORS[ch] || ['#404040','#f5f5f5']; }
// Content generation can legitimately take several minutes because the n8n workflow
// runs multiple LLM branches. Give the workflow enough time before declaring it failed.
export const GIVE_UP_MS = 20 * 60 * 1000;
