import { Story, TopicId, EnergyMode, TOPIC_CATEGORIES } from './types';
import { getLatestCompletedBatchId, getStoriesForTopic } from './db';

/**
 * Assemble a 5-story brief from pre-generated per-topic caches.
 * Slot allocation:
 *   1 topic:  all 5 from topic #1 (server caches 3; slots 4-5 may be empty)
 *   2 topics: Lead(T1), T2, T1-second, T2-second, Wildcard(T1-third)
 *   3 topics: Lead(T1), T2, T3, T1-second, Wildcard(T2-second)
 */
export function assembleBrief(topics: TopicId[], energyMode: EnergyMode): Story[] | null {
  const batchId = getLatestCompletedBatchId();
  if (!batchId) return null;

  // Determine slot allocation
  let slotTopics: TopicId[];
  switch (topics.length) {
    case 0:
      return null;
    case 1:
      slotTopics = [topics[0], topics[0], topics[0], topics[0], topics[0]];
      break;
    case 2:
      // Lead(T1), T2, T1-second, T2-second, Wildcard(T1-third)
      slotTopics = [topics[0], topics[1], topics[0], topics[1], topics[0]];
      break;
    default:
      // Lead(T1), T2, T3, T1-second, Wildcard(T2-second)
      slotTopics = [topics[0], topics[1], topics[2], topics[0], topics[1]];
      break;
  }

  // Count how many stories we need per topic
  const needPerTopic = new Map<TopicId, number>();
  for (const t of slotTopics) {
    needPerTopic.set(t, (needPerTopic.get(t) || 0) + 1);
  }

  // Fetch stories per topic
  const topicStories = new Map<TopicId, Story[]>();
  for (const [topic, count] of needPerTopic) {
    const stories = getStoriesForTopic(topic, 'all', batchId, count);
    if (stories.length === 0) return null; // No stories cached for this topic
    topicStories.set(topic, stories);
  }

  // Assemble in slot order, picking from each topic's pool
  const topicIndex = new Map<TopicId, number>();
  const result: Story[] = [];
  const seenHeadlines = new Set<string>();

  for (const topic of slotTopics) {
    const pool = topicStories.get(topic) || [];
    let idx = topicIndex.get(topic) || 0;

    // Skip duplicates (same headline from overlapping topic pools)
    while (idx < pool.length && seenHeadlines.has(pool[idx].headline.toLowerCase())) {
      idx++;
    }

    if (idx < pool.length) {
      result.push(pool[idx]);
      seenHeadlines.add(pool[idx].headline.toLowerCase());
      topicIndex.set(topic, idx + 1);
    }
  }

  return result.length > 0 ? result : null;
}
