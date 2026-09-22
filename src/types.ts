export type Entry = { path: string; size: number; text?: string };
export type Evidence = { label: string; path: string };
export type Analysis = {
  name: string; framework: string; next: boolean; worker: boolean;
  runtime: 'static' | 'server' | 'unknown'; staticExport: boolean;
  runtimeKind?: 'static' | 'node' | 'next' | 'worker' | 'functions' | 'unknown'; runtimeReason?: string;
  externalApi: boolean; recognized: boolean;
  assets: { path: string; count: number; bytes: number; largest: number } | null;
  evidence: Evidence[]; warnings: string[]; incomplete: boolean; scanned: number; textRead: number;
  capacityIncomplete?: boolean;
  outputReason?: string;
  buildProfiles?: { script: string; mode: string; output?: string; issue?: string }[];
  staticHost?: 'cloudflare';
  historyRouting?: boolean;
};
export type Preferences = { access?: 'public' | 'restricted' | 'unknown'; purpose: 'personal' | 'commercial' | 'unknown'; budget: 'free' | 'paid'; priority: 'simple' | 'growth' | 'preview'; traffic: 'unknown' | 'small' | 'large'; runtime: 'auto' | 'static' | 'server' };
export type Candidate = { id: 'github' | 'vercel' | 'cloudflare'; name: string; plan: string; score: number; blocked: boolean; conditional?: boolean; reasons: string[]; cautions: string[]; condition: string };
