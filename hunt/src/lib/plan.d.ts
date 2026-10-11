export type Task = [cat: 'dsa' | 'build' | 'apply' | 'learn' | 'story' | 'care', text: string, minutes: number, problems?: number, hint?: string];
export const START_DEFAULT: string;
export const TARGETS: { problems: number; apps: number; refs: number; interviews: number };
export const WEEKS: { n: number; title: string; from: number; to: number; aim: string }[];
export const DAYS: { t: string; note: string; k: Task[] }[];
export const CAT_NAME: Record<string, string>;
