export interface Profile {
  company_name: string; company_website: string; company_summary: string;
  company_details: string; target_audience: string; product_options: string[];
  product: string; company_research: string;
}
export interface BrandTheme {
  primary_color: string; secondary_color: string; background_color: string;
  text_color: string; logo_url: string; font_family: string;
}
export interface Prefs { platforms: string[]; goal: string; tone: string; style: string; extra: string; }
export interface Piece {
  id: string; section: string; channel: string; format: string; title: string;
  bodyHtml: string; bodyText: string; wordCount: number;
  mediaUrl?: string; mediaType?: 'image' | 'video' | 'pdf' | 'text';
  mediaPrompt?: string; aspectRatio?: string;
  mediaDuration?: number; mediaSceneCount?: number; mediaSceneTimings?: { scene: number; start: number; end: number }[];
}
export interface ScheduleEntry { date: string; time: string; }
export interface AppState {
  projectId: string | null; jobRowId: string | null;
  url: string; profile: Profile | null; prefs: Prefs;
  jobId: string | null; liveViewToken: string | null; jobStarted: number; finishedAt: string | null; generationRequestId: string | null; brandTheme: BrandTheme | null;
  generationStatus: 'idle' | 'starting' | 'running' | 'partial' | 'completed' | 'cancelled' | 'failed';
  sections: Record<string, Piece[]>; schedule: Record<string, ScheduleEntry>;
}
