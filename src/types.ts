// Types matching the Swift models exactly

export interface KeyStat {
  number: string;
  context: string;
}

export interface TimelineEvent {
  date: string;
  description: string;
}

export interface SourceCoverage {
  name: string;
  angle: string;
  stance: string;
  headline?: string;
  summary?: string;
  date?: string;
  sourceURL?: string;
}

export interface LinkedTerm {
  term: string;
  explanation: string;
}

export interface Story {
  id: string;
  headline: string;
  category: string;
  categoryColor: string;
  hook: string;
  context: string;
  soWhat: string;
  deepDive: string;
  keyStat?: KeyStat;
  keyFacts?: string[];
  source: string;
  sourceURL: string;
  sources: string[];
  readTime: string;
  timestamp: string;
  imageURL?: string;
  timeline?: TimelineEvent[];
  fullCoverage?: SourceCoverage[];
  whatToWatch?: string;
  linkedTerms?: LinkedTerm[];
}

export interface DeepContent {
  timeline?: TimelineEvent[];
  fullCoverage?: SourceCoverage[];
  whatToWatch?: string;
  linkedTerms?: LinkedTerm[];
}

export const TOPICS = [
  'money', 'techAI', 'politics', 'climate', 'healthScience',
  'culture', 'globalAffairs', 'businessStartups', 'sports', 'housingRealEstate'
] as const;

export type TopicId = typeof TOPICS[number];

export const TOPIC_NEWS_PROMPTS: Record<TopicId, string> = {
  money: 'personal finance, investing, cryptocurrency, economic policy',
  techAI: 'artificial intelligence, tech industry, software, gadgets',
  politics: 'politics, policy, elections, government',
  climate: 'climate change, sustainability, environment, energy',
  healthScience: 'health, medical research, science, wellness',
  culture: 'entertainment, arts, media, pop culture, social trends',
  globalAffairs: 'international relations, world politics, geopolitics',
  businessStartups: 'startups, venture capital, entrepreneurship, business strategy',
  sports: 'sports, athletics, major leagues, tournaments',
  housingRealEstate: 'housing market, real estate, mortgages, urban development',
};

export const TOPIC_CATEGORIES: Record<TopicId, string> = {
  money: 'MONEY',
  techAI: 'TECH',
  politics: 'POLITICS',
  climate: 'CLIMATE',
  healthScience: 'HEALTH',
  culture: 'CULTURE',
  globalAffairs: 'WORLD',
  businessStartups: 'BUSINESS',
  sports: 'SPORTS',
  housingRealEstate: 'HOUSING',
};

export const CATEGORY_COLORS: Record<string, string> = {
  MONEY: 'D4A843',
  TECH: '5B7FBF',
  POLITICS: 'C7685E',
  CLIMATE: '5BA89E',
  HEALTH: '6BAF7B',
  CULTURE: '8E8FC7',
  WORLD: 'B07AA8',
  BUSINESS: 'B8705A',
  SPORTS: '4A9EB5',
  HOUSING: 'C4A87A',
};

export type EnergyMode = 'quick' | 'deep';

export const ENERGY_WORD_COUNTS: Record<EnergyMode, number> = {
  quick: 30,
  deep: 100,
};
