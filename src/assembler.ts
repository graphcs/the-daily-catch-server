import { Story, TopicId, EnergyMode, TOPICS } from './types';
import { getLatestCompletedBatchId, getStoriesForTopic, getDeepContent } from './db';

/**
 * Assemble a 5-story brief from pre-generated per-topic caches.
 * Slot allocation matches the iOS app (feat/improve-news-algo):
 *   1 topic:  all 5 from topic #1
 *   2 topics: T1, T2, T1, T2, WILDCARD
 *   3 topics: T1, T2, T3, T1, WILDCARD
 * WILDCARD = a story from any topic NOT already used.
 */
export function assembleBrief(topics: TopicId[], energyMode: EnergyMode, includeDeep: boolean = false): Story[] | null {
  const batchId = getLatestCompletedBatchId();
  if (!batchId) return null;

  // Determine slot allocation (null = wildcard)
  let slotTopics: (TopicId | null)[];
  switch (topics.length) {
    case 0:
      return null;
    case 1:
      slotTopics = [topics[0], topics[0], topics[0], topics[0], topics[0]];
      break;
    case 2:
      slotTopics = [topics[0], topics[1], topics[0], topics[1], null];
      break;
    default:
      slotTopics = [topics[0], topics[1], topics[2], topics[0], null];
      break;
  }

  // Count how many stories we need per topic (excluding wildcard)
  const needPerTopic = new Map<TopicId, number>();
  for (const t of slotTopics) {
    if (t !== null) {
      needPerTopic.set(t, (needPerTopic.get(t) || 0) + 1);
    }
  }

  // Fetch stories per topic
  const topicStories = new Map<TopicId, Story[]>();
  for (const [topic, count] of needPerTopic) {
    const stories = getStoriesForTopic(topic, 'all', batchId, count);
    if (stories.length === 0) return null;
    topicStories.set(topic, stories);
  }

  // Assemble in slot order, picking from each topic's pool
  const topicIndex = new Map<TopicId, number>();
  const result: Story[] = [];
  const seenHeadlines = new Set<string>();
  const usedTopics = new Set<TopicId>();

  for (const topic of slotTopics) {
    if (topic !== null) {
      // Regular slot: pick from this topic's pool
      const pool = topicStories.get(topic) || [];
      let idx = topicIndex.get(topic) || 0;
      while (idx < pool.length && seenHeadlines.has(pool[idx].headline.toLowerCase())) {
        idx++;
      }
      if (idx < pool.length) {
        result.push(pool[idx]);
        seenHeadlines.add(pool[idx].headline.toLowerCase());
        usedTopics.add(topic);
        topicIndex.set(topic, idx + 1);
      }
    } else {
      // WILDCARD slot: pick from any topic NOT already heavily used
      const wildcardTopic = pickWildcardTopic(topics, usedTopics, batchId);
      if (wildcardTopic) {
        const pool = getStoriesForTopic(wildcardTopic, 'all', batchId, 1);
        const story = pool.find(s => !seenHeadlines.has(s.headline.toLowerCase()));
        if (story) {
          result.push(story);
          seenHeadlines.add(story.headline.toLowerCase());
        }
      }
    }
  }

  if (result.length === 0) return null;

  // Merge deep content into stories if requested
  if (includeDeep) {
    for (const story of result) {
      const deep = getDeepContent(story.id);
      if (deep) {
        story.timeline = deep.timeline;
        story.fullCoverage = deep.fullCoverage;
        story.whatToWatch = deep.whatToWatch;
        story.linkedTerms = deep.linkedTerms;
      }
    }
  }

  return result;
}

/**
 * Pick a wildcard topic: prefer topics NOT in the user's selection,
 * falling back to the user's least-used topic.
 */
function pickWildcardTopic(
  userTopics: TopicId[],
  usedTopics: Set<TopicId>,
  batchId: string
): TopicId | null {
  // First try: a topic the user didn't select (for diversity)
  const otherTopics = TOPICS.filter(t => !userTopics.includes(t));
  // Shuffle for variety
  const shuffled = otherTopics.sort(() => Math.random() - 0.5);
  for (const topic of shuffled) {
    const stories = getStoriesForTopic(topic, 'all', batchId, 1);
    if (stories.length > 0) return topic;
  }
  // Fallback: use the user's least-used topic
  for (const topic of [...userTopics].reverse()) {
    if (!usedTopics.has(topic)) return topic;
  }
  return userTopics[0] ?? null;
}
