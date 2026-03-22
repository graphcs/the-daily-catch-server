import express from 'express';
import cors from 'cors';
import cron from 'node-cron';
import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import { TopicId, TOPICS, EnergyMode } from './types';
import { getDb, getStoryById, getDeepContent, getLatestCompletedBatchId } from './db';
import { assembleBrief } from './assembler';
import { runGenerationCycle } from './cron';

const app = express();
app.use(cors());
app.use(express.json());

// --- Swagger setup ---

const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'The Daily Catch API',
      version: '1.0.0',
      description: 'Backend API for The Daily Catch news app. Pre-generates and caches personalized news briefs.',
    },
    servers: [
      { url: '/', description: 'Current server' },
    ],
  },
  apis: [__filename],
});

app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'The Daily Catch API',
}));

// --- Initialize DB on startup ---
getDb();

// --- Routes ---

/**
 * @openapi
 * /api/health:
 *   get:
 *     summary: Health check
 *     tags: [System]
 *     responses:
 *       200:
 *         description: Server is healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                 latestBatch:
 *                   type: string
 *                   nullable: true
 */
app.get('/api/health', (_req, res) => {
  const batchId = getLatestCompletedBatchId();
  res.json({
    status: 'ok',
    latestBatch: batchId,
    timestamp: new Date().toISOString(),
  });
});

/**
 * @openapi
 * /api/brief:
 *   get:
 *     summary: Get assembled news brief
 *     description: Returns 5 stories assembled from pre-generated topic caches based on ranked topic preferences.
 *     tags: [Brief]
 *     parameters:
 *       - in: query
 *         name: topics
 *         required: true
 *         schema:
 *           type: string
 *         description: "Comma-separated ranked topics (1-3). Values: money, techAI, politics, climate, healthScience, culture, globalAffairs, businessStartups, sports, housingRealEstate"
 *         example: techAI,politics,money
 *       - in: query
 *         name: energy
 *         required: true
 *         schema:
 *           type: string
 *           enum: [quick, deep]
 *         description: Energy mode (quick = ~30 word summaries, deep = ~100 word summaries)
 *         example: quick
 *     responses:
 *       200:
 *         description: Assembled brief with 5 stories
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 generatedAt:
 *                   type: string
 *                 stories:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       headline:
 *                         type: string
 *                       category:
 *                         type: string
 *                       categoryColor:
 *                         type: string
 *                       hook:
 *                         type: string
 *                       context:
 *                         type: string
 *                       soWhat:
 *                         type: string
 *                       deepDive:
 *                         type: string
 *                       keyStat:
 *                         type: object
 *                         nullable: true
 *                       keyFacts:
 *                         type: array
 *                         items:
 *                           type: string
 *                         nullable: true
 *                       source:
 *                         type: string
 *                       sourceURL:
 *                         type: string
 *                       sources:
 *                         type: array
 *                         items:
 *                           type: string
 *                       readTime:
 *                         type: string
 *                       timestamp:
 *                         type: string
 *       400:
 *         description: Invalid parameters
 *       503:
 *         description: No stories cached yet
 */
app.get('/api/brief', (req, res) => {
  const topicsParam = req.query.topics as string;
  const energyParam = req.query.energy as string;

  if (!topicsParam || !energyParam) {
    res.status(400).json({ error: 'Missing required params: topics, energy' });
    return;
  }

  const topics = topicsParam.split(',').filter(t => TOPICS.includes(t as TopicId)) as TopicId[];
  if (topics.length === 0) {
    res.status(400).json({ error: `Invalid topics. Valid values: ${TOPICS.join(', ')}` });
    return;
  }
  if (topics.length > 3) {
    topics.length = 3; // Silently cap at 3
  }

  const energy = energyParam as EnergyMode;
  if (energy !== 'quick' && energy !== 'deep') {
    res.status(400).json({ error: 'Invalid energy mode. Must be "quick" or "deep"' });
    return;
  }

  const stories = assembleBrief(topics, energy);
  if (!stories) {
    res.status(503).json({
      error: 'No stories cached yet. Trigger a refresh with POST /api/admin/refresh',
    });
    return;
  }

  res.json({
    generatedAt: new Date().toISOString(),
    stories,
  });
});

/**
 * @openapi
 * /api/deep/{storyId}:
 *   get:
 *     summary: Get deep content for a story
 *     description: Returns pre-generated deep dive content (timeline, full coverage, what to watch, linked terms).
 *     tags: [Deep Content]
 *     parameters:
 *       - in: path
 *         name: storyId
 *         required: true
 *         schema:
 *           type: string
 *         description: The story UUID
 *     responses:
 *       200:
 *         description: Deep content for the story
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 timeline:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       date:
 *                         type: string
 *                       description:
 *                         type: string
 *                 fullCoverage:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       name:
 *                         type: string
 *                       angle:
 *                         type: string
 *                       stance:
 *                         type: string
 *                       headline:
 *                         type: string
 *                       summary:
 *                         type: string
 *                       date:
 *                         type: string
 *                       sourceURL:
 *                         type: string
 *                 whatToWatch:
 *                   type: string
 *                 linkedTerms:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       term:
 *                         type: string
 *                       explanation:
 *                         type: string
 *       404:
 *         description: Story or deep content not found
 */
app.get('/api/deep/:storyId', (req, res) => {
  const { storyId } = req.params;

  const deep = getDeepContent(storyId);
  if (!deep) {
    // Check if the story exists at all
    const story = getStoryById(storyId);
    if (!story) {
      res.status(404).json({ error: 'Story not found' });
      return;
    }
    res.status(404).json({ error: 'Deep content not yet generated for this story' });
    return;
  }

  res.json(deep);
});

/**
 * @openapi
 * /api/admin/refresh:
 *   post:
 *     summary: Trigger story regeneration
 *     description: Forces an immediate generation cycle. Generates stories for all topics and energy modes.
 *     tags: [Admin]
 *     responses:
 *       200:
 *         description: Generation cycle completed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 batchId:
 *                   type: string
 *                 storiesGenerated:
 *                   type: number
 *                 errors:
 *                   type: array
 *                   items:
 *                     type: string
 */
app.post('/api/admin/refresh', async (_req, res) => {
  try {
    const result = await runGenerationCycle();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: `Generation failed: ${err}` });
  }
});

// --- Cron schedule: every 6 hours ---
cron.schedule('0 */6 * * *', async () => {
  console.log('[cron] Scheduled generation cycle starting...');
  try {
    await runGenerationCycle();
  } catch (err) {
    console.error('[cron] Scheduled cycle failed:', err);
  }
});

// --- Start server ---
const PORT = parseInt(process.env.PORT || '3000', 10);
app.listen(PORT, '0.0.0.0', () => {
  console.log(`The Daily Catch server running on port ${PORT}`);
  console.log(`Swagger docs: http://localhost:${PORT}/api/docs`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
});
