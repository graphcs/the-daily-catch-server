import { v4 as uuidv4 } from 'uuid';
import { TOPICS, TopicId, EnergyMode } from './types';
import { generateStoriesForTopic, generateDeepContent } from './generator';
import {
  createBatch, completeBatch, saveStories, saveDeepContent, deleteOldBatches,
} from './db';

const ENERGY_MODES: EnergyMode[] = ['quick', 'deep'];

/**
 * Run a full generation cycle:
 * 1. Generate 3 stories per topic per energy mode (10 topics x 2 modes = 20 API calls)
 * 2. Generate deep content for each story (~60 API calls, or fewer with batching)
 * 3. Store everything in SQLite
 */
export async function runGenerationCycle(): Promise<{ batchId: string; storiesGenerated: number; errors: string[] }> {
  const batchId = uuidv4();
  const errors: string[] = [];
  let storiesGenerated = 0;

  console.log(`[cron] Starting generation cycle, batch=${batchId}`);
  createBatch(batchId);

  // Phase 1: Generate stories per topic per energy mode
  for (const topic of TOPICS) {
    for (const mode of ENERGY_MODES) {
      try {
        console.log(`[cron] Generating ${mode} stories for ${topic}...`);
        const stories = await generateStoriesForTopic(topic as TopicId, mode);
        saveStories(stories, topic, mode, batchId);
        storiesGenerated += stories.length;

        // Phase 2: Generate deep content for each story
        for (const story of stories) {
          try {
            console.log(`[cron]   Deep content for "${story.headline.substring(0, 40)}..."`);
            const deep = await generateDeepContent(story);
            saveDeepContent(story.id, deep);
          } catch (err) {
            const msg = `Deep content failed for ${story.id}: ${err}`;
            console.error(`[cron]   ${msg}`);
            errors.push(msg);
          }
        }

        // Small delay between API calls to avoid rate limiting
        await new Promise(r => setTimeout(r, 1000));
      } catch (err) {
        const msg = `Stories failed for ${topic}/${mode}: ${err}`;
        console.error(`[cron] ${msg}`);
        errors.push(msg);
      }
    }
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
