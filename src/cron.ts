import { v4 as uuidv4 } from 'uuid';
import { TOPICS, TopicId } from './types';
import { generateStoriesForTopic } from './generator';
import {
  createBatch, completeBatch, saveStories, deleteOldBatches,
} from './db';

const CONCURRENCY = 5; // Run 5 topic generations in parallel

/**
 * Run a generation cycle:
 * - Generate 3 stories per topic (10 topics, 5 at a time in parallel)
 * - Store as "quick" mode (the server assembler serves these for both modes)
 * - Skip deep content pre-generation (app falls back to direct API)
 * - Total: ~10 API calls, completes in ~2-3 minutes
 */
export async function runGenerationCycle(): Promise<{ batchId: string; storiesGenerated: number; errors: string[] }> {
  const batchId = uuidv4();
  const errors: string[] = [];
  let storiesGenerated = 0;

  console.log(`[cron] Starting generation cycle, batch=${batchId}`);
  createBatch(batchId);

  // Process topics in batches of CONCURRENCY
  const topicList = [...TOPICS];
  for (let i = 0; i < topicList.length; i += CONCURRENCY) {
    const batch = topicList.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async (topic) => {
        console.log(`[cron] Generating stories for ${topic}...`);
        try {
          const stories = await generateStoriesForTopic(topic as TopicId, 'quick');
          // Save as both quick and deep (same content, server doesn't differentiate word count)
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

  // Clean up old batches (keep last 3)
  deleteOldBatches(3);

  return { batchId, storiesGenerated, errors };
}
