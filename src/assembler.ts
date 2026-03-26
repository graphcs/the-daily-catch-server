import { Story, TopicId, EnergyMode } from './types';
import { getLatestCompletedBatchId, getStoriesForTopic, getDeepContent } from './db';

/**
 * Assemble a 5-story brief from pre-generated per-topic caches.
 * Slot allocation:
 *   1 topic:  T1, T1, T1, T1, T1
 *   2 topics: T1, T2, T1, T2, (T1 or T2)
 *   3 topics: T1, T2, T3, T1, (T1 or T2 or T3)
 * The 5th slot always comes from the user's own topics.
 */
export function assembleBrief(topics: TopicId[], energyMode: EnergyMode, includeDeep: boolean = false): Story[] | null {
  const batchId = getLatestCompletedBatchId();
  if (!batchId) return null;

  // Determine slot allocation (null = pick from user's topics)
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

  // Fetch stories per topic — up to 5 each
  const topicStories = new Map<TopicId, Story[]>();
  for (const topic of topics) {
    const stories = getStoriesForTopic(topic, 'all', batchId, 5);
    if (stories.length === 0) return null;
    topicStories.set(topic, stories);
  }

  // Assemble in slot order
  const topicIndex = new Map<TopicId, number>();
  const result: Story[] = [];
  const seenHeadlines = new Set<string>();

  for (const topic of slotTopics) {
    if (topic !== null) {
      const story = pickNextStory(topic, topicStories, topicIndex, seenHeadlines);
      if (story) result.push(story);
    } else {
      // 5th slot: pick from whichever user topic has an unused story
      const story = pickFromUserTopics(topics, topicStories, topicIndex, seenHeadlines);
      if (story) result.push(story);
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

function pickNextStory(
  topic: TopicId,
  topicStories: Map<TopicId, Story[]>,
  topicIndex: Map<TopicId, number>,
  seenHeadlines: Set<string>
): Story | null {
  const pool = topicStories.get(topic) || [];
  let idx = topicIndex.get(topic) || 0;
  while (idx < pool.length && seenHeadlines.has(pool[idx].headline.toLowerCase())) {
    idx++;
  }
  if (idx < pool.length) {
    seenHeadlines.add(pool[idx].headline.toLowerCase());
    topicIndex.set(topic, idx + 1);
    return pool[idx];
  }
  return null;
}

/**
 * Pick a story from any of the user's selected topics (for the wildcard slot).
 * Tries each topic in order, returning the first unused story found.
 */
function pickFromUserTopics(
  userTopics: TopicId[],
  topicStories: Map<TopicId, Story[]>,
  topicIndex: Map<TopicId, number>,
  seenHeadlines: Set<string>
): Story | null {
  for (const topic of userTopics) {
    const story = pickNextStory(topic, topicStories, topicIndex, seenHeadlines);
    if (story) return story;
  }
  return null;
}
