export type Entry = { path: string; size: number; text?: string };
export type Evidence = { label: string; path: string };
export type Analysis = {
  name: string; framework: string; next: boolean; worker: boolean;
  runtime: 'static' | 'server' | 'unknown'; staticExport: boolean;
  externalApi: boolean; recognized: boolean;
  assets: { path: string; count: number; bytes: number; largest: number } | null;
  evidence: Evidence[]; warnings: string[]; incomplete: boolean; scanned: number;
};
export type Preferences = { purpose: 'personal' | 'commercial' | 'unknown'; budget: 'free' | 'paid'; priority: 'simple' | 'growth' | 'preview'; traffic: 'unknown' | 'small' | 'large'; runtime: 'auto' | 'static' | 'server' };
export type Candidate = { id: 'github' | 'vercel' | 'cloudflare'; name: string; plan: string; score: number; blocked: boolean; reasons: string[]; cautions: string[]; condition: string };
