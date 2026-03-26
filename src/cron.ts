import { v4 as uuidv4 } from 'uuid';
import { TOPICS, TopicId, Story } from './types';
import { generateStoriesForTopic, generateDeepContent } from './generator';
import {
  createBatch, completeBatch, saveStories, saveDeepContent,
  deleteOldBatches, getLatestCompletedBatchId, getStoriesForTopics,
} from './db';

const CONCURRENCY = 5;
const DEEP_CONCURRENCY = 5;

// Topic batches for staggered deep content generation
export const DEEP_BATCH_1: TopicId[] = ['money', 'techAI', 'politics', 'climate', 'healthScience'];
export const DEEP_BATCH_2: TopicId[] = ['culture', 'globalAffairs', 'businessStartups', 'sports', 'housingRealEstate'];

/**
 * Generate stories for all topics (~22s).
 * Does NOT generate deep content — that's handled by separate batched calls.
 */
export async function runGenerationCycle(): Promise<{ batchId: string; storiesGenerated: number; errors: string[] }> {
  const batchId = uuidv4();
  const errors: string[] = [];
  let storiesGenerated = 0;

  console.log(`[cron] Starting story generation, batch=${batchId}`);
  createBatch(batchId);

  const topicList = [...TOPICS];
  for (let i = 0; i < topicList.length; i += CONCURRENCY) {
    const batch = topicList.slice(i, i + CONCURRENCY);
    await Promise.allSettled(
      batch.map(async (topic) => {
        console.log(`[cron] Generating stories for ${topic}...`);
        try {
          const stories = await generateStoriesForTopic(topic as TopicId, 'quick');
          saveStories(stories, topic, 'all', batchId);
          storiesGenerated += stories.length;
          console.log(`[cron] ✓ ${topic}: ${stories.length} stories`);
        } catch (err) {
          const msg = `Failed for ${topic}: ${err}`;
          console.error(`[cron] ✗ ${topic}: ${msg}`);
          errors.push(msg);
        }
      })
    );
  }

  if (storiesGenerated > 0) {
    completeBatch(batchId, 'completed');
    console.log(`[cron] Batch ${batchId} completed: ${storiesGenerated} stories, ${errors.length} errors`);
  } else {
    completeBatch(batchId, 'failed');
    console.error(`[cron] Batch ${batchId} failed: no stories generated`);
  }

  deleteOldBatches(3);
  return { batchId, storiesGenerated, errors };
}

/**
 * Generate deep content for stories in the given topics.
 * Fetches stories from the latest completed batch and generates
 * deep content (timeline, fullCoverage, whatToWatch, linkedTerms)
 * with DEEP_CONCURRENCY parallel calls.
 */
export async function runDeepContentBatch(topics: TopicId[]): Promise<{ deepGenerated: number; errors: string[] }> {
  const batchId = getLatestCompletedBatchId();
  if (!batchId) {
    return { deepGenerated: 0, errors: ['No completed batch found — run story refresh first'] };
  }

  const stories = getStoriesForTopics(topics, batchId);
  console.log(`[cron] Generating deep content for ${stories.length} stories (topics: ${topics.join(', ')})`);

  const errors: string[] = [];
  let deepGenerated = 0;

  for (let i = 0; i < stories.length; i += DEEP_CONCURRENCY) {
    const batch = stories.slice(i, i + DEEP_CONCURRENCY);
    await Promise.allSettled(
      batch.map(async (story) => {
        try {
          console.log(`[cron]   Deep: "${story.headline.substring(0, 50)}..."`);
          const deep = await generateDeepContent(story);
          saveDeepContent(story.id, deep);
          deepGenerated++;
        } catch (err) {
          const msg = `Deep failed for ${story.id}: ${err}`;
          console.error(`[cron]   ✗ ${msg}`);
          errors.push(msg);
        }
      })
    );
  }

  console.log(`[cron] Deep content batch done: ${deepGenerated} generated, ${errors.length} errors`);
  return { deepGenerated, errors };
}

/**
 * Generate deep content for ALL stories in the latest batch.
 */
export async function runAllDeepContent(): Promise<{ deepGenerated: number; errors: string[] }> {
  const result1 = await runDeepContentBatch(DEEP_BATCH_1);
  const result2 = await runDeepContentBatch(DEEP_BATCH_2);
  return {
    deepGenerated: result1.deepGenerated + result2.deepGenerated,
    errors: [...result1.errors, ...result2.errors],
  };
}
