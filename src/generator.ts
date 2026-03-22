import { v4 as uuidv4 } from 'uuid';
import {
  Story, DeepContent, TopicId, EnergyMode,
  TOPIC_NEWS_PROMPTS, TOPIC_CATEGORIES, CATEGORY_COLORS,
  ENERGY_WORD_COUNTS,
} from './types';

const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = 'perplexity/sonar';

function getApiKey(): string {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('OPENROUTER_API_KEY not set');
  return key;
}

function colorForCategory(category: string): string {
  return CATEGORY_COLORS[category.toUpperCase()] ?? '3366FF';
}

const ALL_CATEGORIES = 'MONEY, TECH, POLITICS, CLIMATE, HEALTH, CULTURE, WORLD, BUSINESS, SPORTS, HOUSING';

const VIOLENCE_SIGNALS = [
  'missile', 'airstrike', 'troops', 'invasion', 'war with',
  'iran', 'israel', 'gaza', 'ukraine', 'hamas', 'hezbollah',
  'shooter', 'shooting', 'gunman', 'gunfire', 'mass shooting',
  'truck attack', 'attack on', 'bombing', 'stabbing', 'terrorist',
  'hate crime', 'antisemit', 'synagogue', 'mosque attack', 'church attack',
];

function isViolenceStory(story: { headline: string; hook: string; context: string }): boolean {
  const text = ` ${story.headline} ${story.hook} ${story.context} `.toLowerCase();
  return VIOLENCE_SIGNALS.some(signal => text.includes(signal));
}

async function callOpenRouter(systemPrompt: string, userPrompt: string): Promise<string> {
  const res = await fetch(OPENROUTER_ENDPOINT, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${getApiKey()}`,
      'Content-Type': 'application/json',
      'X-Title': 'The Daily Catch',
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenRouter API error ${res.status}: ${body}`);
  }

  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('No content in OpenRouter response');

  return content
    .replace(/```json/g, '')
    .replace(/```/g, '')
    .trim();
}

/**
 * Generate 3 stories for a single topic in a given energy mode.
 */
export async function generateStoriesForTopic(
  topic: TopicId,
  energyMode: EnergyMode
): Promise<Story[]> {
  const category = TOPIC_CATEGORIES[topic];
  const newsPrompt = TOPIC_NEWS_PROMPTS[topic];
  const wordCount = ENERGY_WORD_COUNTS[energyMode];

  const today = new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  const systemPrompt = `You are a news curator who prioritizes understanding over volume. \
For every story, start with "why would a busy person care about this?" and work backward to what happened.

SELECTION FILTERS — apply all three before including a story:
1. Scale of Impact: Does this change how people live, work, spend, or plan?
2. Dinner Table Test: Would someone who doesn't follow the news find this interesting?
3. Context Gap: Is this something people saw a headline about but couldn't explain?

EDITORIAL RULES:
- Never editorialize on who is right or wrong.
- No loaded adjectives ("controversial," "shocking," "unprecedented").
- Do not frame stories as two-sided conflicts when they are more nuanced.
- Let facts and context do the work.
- When uncertain, say so: "it's unclear whether," "analysts are divided on."

Keep it balanced and accessible.`;

  const userPrompt = `Today is ${today}. Give me the 3 most important stories from the last 24-48 hours about ${newsPrompt}.

ALL 3 STORIES MUST BE CATEGORY: "${category}"

STORY #1 — LEAD STORY:
Story #1 should be the BIGGEST, most impactful headline in ${newsPrompt}. Apply the Dinner Table Test: pick the story that people are most likely talking about right now.

WHAT "GENUINELY FITS" MEANS — apply this test: "Would this story appear in a dedicated [CATEGORY] section of a major newspaper?" If no, pick a different story.
- TECH = technology companies, products, AI, software, hardware, chips, apps
- BUSINESS = companies, earnings, markets, startups, M&A, retail
- MONEY = personal finance, investing, interest rates, crypto, economic indicators
- WORLD = international relations, geopolitics, foreign affairs
- POLITICS = domestic policy, elections, legislation, government
- HEALTH = medical research, public health, wellness
- CLIMATE = environment, energy, sustainability
- CULTURE = entertainment, arts, media, social trends
- SPORTS = athletic competitions, teams, players, tournaments
- HOUSING = real estate, mortgages, urban development

CRITICAL — STORIES MUST BE INDEPENDENT:
- Each of the 3 stories must be about a completely different event, topic, and subject.
- NO OVERLAP: If one story is about a war or conflict, the other stories MUST NOT mention that war.
- A story about Trump, a president, military action, war, Pentagon, sanctions is a POLITICS or WORLD story. It is NEVER a TECH, BUSINESS, MONEY, HEALTH, SPORTS, CULTURE, or HOUSING story.

RECENCY: Only include stories that broke or had major developments within the last 48 hours.

SOURCE REQUIREMENTS:
- Each story must be informed by at least 2-3 cross-referenced sources.
- Prefer wire services (Reuters, AP) as the factual backbone.

CATEGORY VALUES — use EXACTLY these strings, no variations:
${ALL_CATEGORIES}

For each story, provide a JSON object with these exact fields:
- "category": "${category}" (MUST be exactly this for all 3 stories)
- "headline": clear, compelling headline (max 12 words)
- "hook": One sentence. What happened, in plain language. Roughly ${wordCount} words.
- "context": Two to three sentences. Why this is happening now. Roughly ${wordCount} words.
- "soWhat": One to two sentences. How this affects the reader's life, money, or world.
- "keyStat": {"number": "90%", "context": "of..."} — the single most striking statistic. Omit if none.
- "keyFacts": array of 5-7 strings, each a single concise fact.
- "deepDive": 3-4 sentences going deeper — historical context, stakeholders, trends.
- "source": name of the primary news source
- "sourceURL": URL to the original article
- "sources": array of exactly 3 real outlet names consulted
- "readTime": estimated read time (e.g. "2 min read")
- "timestamp": when the story broke (e.g. "2h ago", "Today")

Return ONLY a JSON array of 3 objects. No markdown, no code fences, just the raw JSON array.`;

  const raw = await callOpenRouter(systemPrompt, userPrompt);
  const parsed = JSON.parse(raw) as Record<string, unknown>[];

  return parsed.map((dict) => {
    const story: Story = {
      id: uuidv4(),
      headline: (dict.headline as string) || '',
      category: category,
      categoryColor: colorForCategory(category),
      hook: (dict.hook as string) || '',
      context: (dict.context as string) || '',
      soWhat: (dict.soWhat as string) || '',
      deepDive: (dict.deepDive as string) || `${dict.hook} ${dict.context}`,
      keyStat: dict.keyStat as Story['keyStat'],
      keyFacts: dict.keyFacts as string[] | undefined,
      source: (dict.source as string) || '',
      sourceURL: (dict.sourceURL as string) || '',
      sources: (dict.sources as string[]) || [(dict.source as string) || ''],
      readTime: (dict.readTime as string) || '2 min read',
      timestamp: (dict.timestamp as string) || 'Today',
      imageURL: typeof dict.imageURL === 'string' && dict.imageURL.startsWith('http')
        ? dict.imageURL : undefined,
    };

    // Violence check: if it's a violence story, force to WORLD
    if (isViolenceStory(story) && category !== 'WORLD' && category !== 'POLITICS') {
      story.category = 'WORLD';
      story.categoryColor = colorForCategory('WORLD');
    }

    return story;
  });
}

/**
 * Generate deep content for a single story.
 */
export async function generateDeepContent(story: Story): Promise<DeepContent> {
  const systemPrompt = `You are a news analyst providing deep-dive content for a specific story. \
Be factual, balanced, and thorough.`;

  const sourcesHint = story.sources.join(', ');

  const userPrompt = `Given this news story:

Headline: ${story.headline}
Summary: ${story.hook}
Context: ${story.context}
Sources consulted: ${sourcesHint}

Provide deep-dive supplementary content as a single JSON object with these fields:

- "timeline": array of 3-5 objects with {"date": "Mar 2024", "description": "What happened"} — chronological events leading to this story
- "fullCoverage": array of EXACTLY 3 objects with {"name": "Reuters", "angle": "Market reaction — shares rose 4%...", "stance": "Neutral", "headline": "Article headline from this source", "summary": "4-6 paragraph summary of this outlet's reporting. Cover the main event, key quotes, data points, and context. Write in neutral journalistic tone. Separate paragraphs with double newlines.", "date": "March 4, 2026", "sourceURL": "https://..."} — different outlets' perspectives. Stance must be one of: "Neutral", "Analytical", "Critical", "Positive". sourceURL must be a real, valid URL to the actual article. The "name" should use real outlet names like ${sourcesHint}.
- "whatToWatch": 1-2 sentences of forward-looking analysis — what could happen next
- "linkedTerms": array of 2-3 objects with {"term": "jargon word", "explanation": "plain English explanation"} — terms the average reader would NOT know. Pick terms a reader would actually Google.

Return ONLY a single JSON object (NOT an array). No markdown, no code fences, just the raw JSON object.`;

  const raw = await callOpenRouter(systemPrompt, userPrompt);
  const dict = JSON.parse(raw) as Record<string, unknown>;

  return {
    timeline: dict.timeline as DeepContent['timeline'],
    fullCoverage: dict.fullCoverage as DeepContent['fullCoverage'],
    whatToWatch: dict.whatToWatch as string | undefined,
    linkedTerms: dict.linkedTerms as DeepContent['linkedTerms'],
  };
}
