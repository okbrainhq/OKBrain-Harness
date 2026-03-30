import { test, expect } from '@playwright/test';
import { loadTestEnv, setupPageWithUser } from './test-utils';
import * as path from 'path';

loadTestEnv();

function getDb() {
  const Database = require('better-sqlite3');
  const dbPath = path.resolve(process.env.TEST_DB_PATH || 'brain.test.db');
  return new Database(dbPath);
}

function seedFactSheet(
  userId: string,
  entries: Array<{ category: string; fact: string }>,
  source: string = 'qwen'
) {
  const { v4: uuidv4 } = require('uuid');
  const db = getDb();

  // Use a timestamp 1 hour in the past so server-created sheets (via DEFAULT CURRENT_TIMESTAMP)
  // always sort newer than seeded ones.
  const pastTimestamp = new Date(Date.now() - 60 * 60 * 1000).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');

  db.prepare(`
    INSERT INTO fact_sheets (id, user_id, facts_json, dedup_log, fact_count, source, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(uuidv4(), userId, JSON.stringify(entries), null, entries.length, source, pastTimestamp);

  db.pragma('wal_checkpoint(FULL)');
  db.close();
}

function seedFacts(userId: string, facts: Array<{ category: string; fact: string }>) {
  const { v4: uuidv4 } = require('uuid');
  const db = getDb();

  const insert = db.prepare(`
    INSERT INTO facts (id, user_id, category, fact, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  for (const fact of facts) {
    insert.run(uuidv4(), userId, fact.category, fact.fact, new Date().toISOString());
  }

  db.pragma('wal_checkpoint(FULL)');
  db.close();
}

function seedChatMessages(userId: string, conversations: Array<{
  title?: string;
  messages: Array<{ role: string; content: string }>;
}>) {
  const Database = require('better-sqlite3');
  const { v4: uuidv4 } = require('uuid');
  const dbPath = path.resolve(process.env.TEST_DB_PATH || 'brain.test.db');
  const db = new Database(dbPath);

  const insertConv = db.prepare(`
    INSERT INTO conversations (id, user_id, title, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  const insertEvent = db.prepare(`
    INSERT INTO chat_events (id, conversation_id, seq, kind, content, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  for (const conv of conversations) {
    const conversationId = uuidv4();
    const now = new Date().toISOString();
    insertConv.run(conversationId, userId, conv.title || 'Test Conversation', now, now);

    let seq = 1;
    for (const msg of conv.messages) {
      const kind = msg.role === 'user' ? 'user_message' : 'assistant_text';
      const content = msg.role === 'user'
        ? JSON.stringify({ text: msg.content })
        : JSON.stringify({ text: msg.content, model: 'test' });
      insertEvent.run(uuidv4(), conversationId, seq, kind, content, now);
      seq++;
    }
  }

  db.pragma('wal_checkpoint(FULL)');
  db.close();
}

async function getFactSheetViaApi(
  request: any,
  headers: Record<string, string>,
  source?: string
): Promise<Array<{ category: string; fact: string }> | null> {
  const url = source
    ? `http://localhost:3001/api/fact-sheet?source=${source}`
    : 'http://localhost:3001/api/fact-sheet';
  const res = await request.get(url, { headers });
  if (!res.ok()) return null;
  const data = await res.json();
  return data.facts || null;
}

async function triggerRebuildJob(request: any, headers: Record<string, string>): Promise<void> {
  // Create the job
  const createRes = await request.post('http://localhost:3001/api/jobs', {
    data: { type: 'fact-sheet-daily-rebuild' },
    headers,
  });
  const job = await createRes.json();

  // Start the job
  await request.post(`http://localhost:3001/api/jobs/${job.id}/start`, {
    data: { input: {} },
    headers,
  });

  // Poll until completed
  for (let i = 0; i < 120; i++) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    const res = await request.get(`http://localhost:3001/api/jobs/${job.id}`, { headers });
    const current = await res.json();
    if (current.state === 'succeeded' || current.state === 'failed') {
      if (current.state === 'failed') {
        throw new Error(`Rebuild job failed`);
      }
      return;
    }
  }
  throw new Error('Rebuild job timed out');
}

const MAX_FACT_CHARS = 120;

const CATEGORY_MAX_FACTS: Record<string, number> = {
  core: 30,
  technical: 25,
  project: 25,
  transient: 40,
};

// Synthetic facts about a fictional marine biologist — at production-like max capacity.
// Some entries are deliberately long/compound (>120 chars) to mimic real production state.

const FULL_CORE_FACTS = [
  // Short atomic facts
  'Dr. Marina Kowalski is a marine biologist based in Halifax, Nova Scotia',
  'Has a 12-year-old son named Theo who plays competitive chess',
  'Married to David who works as a civil engineer',
  'Holds a PhD from Dalhousie University in marine ecology',
  'Speaks English, Polish, and conversational French',
  'Allergic to shellfish despite working with marine life',
  'Born in Gdansk, Poland and moved to Canada at age 14',
  'Runs a weekly ocean science podcast called Deep Currents',
  'Volunteers at the Halifax Marine Rescue Center on weekends',
  'Drives a Toyota Tacoma for field work and tows a research boat',
  'Member of the Canadian Society for Ecology and Evolution',
  'Published 23 peer-reviewed papers in marine ecology journals',
  'Holds a PADI Divemaster certification for research diving',
  'Won the 2024 Chicken of the Sea Marine Conservation Award',
  'Maintains a personal blog about ocean conservation',
  'Grew up fishing with her grandfather on the Baltic Sea',
  'Has a golden retriever named Barnacle who comes on field trips',
  'Prefers tea over coffee and drinks Earl Grey every morning',
  'Plays violin in the Halifax community orchestra',
  'Enjoys cross-country skiing during Nova Scotia winters',
  'Has a home office overlooking Bedford Basin',
  'Reads science fiction novels by Kim Stanley Robinson',
  'Active on Mastodon for science communication',
  // Deliberately long compound entries (>120 chars) — like production
  'Identifies as a conservation-first researcher who prioritizes ecosystem health over publication metrics and grant funding opportunities',
  'Maintains close ties with the Polish marine biology community at the University of Gdansk and co-supervises two PhD students remotely',
  'Parent to Theo who recently won the provincial chess championship, and volunteers as a chess club mentor at his school every Thursday',
  'Values open science and publishes all datasets openly on Zenodo, believing that taxpayer-funded research should be freely accessible to all',
  'Holds dual Canadian-Polish citizenship and travels to Gdansk annually to visit extended family and attend the Baltic Marine Science conference',
  'Investment portfolio includes index funds, a small rental property in Dartmouth, and regular contributions to Theo\'s RESP education savings',
  'Known for bringing homemade pierogi to department potlucks and organizing annual lab retreats at a cabin in Cape Breton Highlands',
]; // 30 = max for core

const FULL_TECHNICAL_FACTS = [
  // Short atomic facts
  'Uses R and Python for statistical modeling',
  'Runs Panasonic Toughbook laptops in the field',
  'Deploys LoRa mesh sensor networks underwater',
  'Stores data in PostgreSQL with PostGIS extensions',
  'Prefers JupyterLab over RStudio',
  'Maps coral reefs using QGIS',
  'Builds Arduino water quality monitors',
  'Writes Snakemake pipelines for workflows',
  'Programs Raspberry Pi for buoy telemetry',
  'Uses FFmpeg for underwater video processing',
  'Runs TensorFlow for species classification',
  'Uses Docker for reproducible analysis',
  'Uses LaTeX for writing research papers',
  'Manages packages with conda environments',
  'Uses ESP32 microcontrollers for sensors',
  'Deploys Flask APIs for field data submission',
  'Uses Git and GitHub for version control',
  // Deliberately long compound entries (>120 chars)
  'Evaluates hydrophone arrays from Cetacean Research Technology and Ocean Sonics, comparing frequency response and noise floor for whale detection',
  'Utilizes the MLX framework optimized for Apple Silicon when running lightweight classification models on her MacBook Pro during fieldwork',
  'Implements local RAG search over research papers using Ollama embeddings and a custom ChromaDB vector store for literature review automation',
  'Prefers SQLite for portable field databases and PostgreSQL with PostGIS for the main lab server, choosing based on connectivity requirements',
  'Sources custom waterproof enclosures from Polycase and designs PCB sensor boards in KiCad, fabricating through JLCPCB with lead-free assembly',
  'Uses Tailscale for secure remote access to lab servers from field sites and campus VPN as fallback when Tailscale nodes are unreachable',
  'Operates a DJI Matrice 350 drone with a multispectral camera for aerial reef mapping, processing imagery in Agisoft Metashape and OpenDroneMap',
  'Develops with VS Code Remote SSH into the lab server, using Copilot for R scripts and maintaining strict version pinning for reproducibility',
]; // 25 = max for technical

const FULL_PROJECT_FACTS = [
  // Short atomic facts
  'Leading kelp forest restoration in Bay of Fundy',
  'Building whale acoustic classifier with spectrograms',
  'Co-authoring microplastic distribution paper',
  'Developing citizen science marine debris app',
  'Collaborating with NOAA on salmon tracking',
  'Designing a portable eDNA sampling kit',
  'Writing a grant proposal for Arctic research',
  'Supervising two MSc students on seal behavior',
  'Organizing the 2027 Maritime Marine Science Symposium',
  'Building a real-time ocean temperature dashboard',
  'Testing biodegradable fishing net prototypes',
  'Creating educational materials for schools',
  'Partnering with DFO on lobster population surveys',
  'Setting up long-term monitoring at Sable Island',
  'Reviewing manuscripts for Marine Ecology Progress Series',
  // Deliberately long compound entries (>120 chars)
  'Launching the Atlantic Coastal Monitoring Network in April connecting twelve sensor stations from Newfoundland to Maine with real-time data feeds',
  'Architecture uses a custom Raspberry Pi mesh network with LoRa backhaul, solar power, and satellite uplink for remote monitoring stations',
  'Developing a comprehensive training curriculum for citizen scientists covering species identification, data collection protocols, and safety procedures',
  'Coordinating a multi-institution study on microplastic accumulation in Arctic sea ice cores with partners from Norway, Denmark, and Iceland',
  'Building an open-source underwater acoustic monitoring platform using Raspberry Pi, HiFiBerry DAC, and custom hydrophones for community deployment',
  'Designing and deploying autonomous underwater vehicles for deep-water coral surveys in partnership with the Ocean Tracking Network and Dalhousie engineering',
  'Managing a three-year NSERC Discovery Grant studying the impact of warming ocean temperatures on juvenile Atlantic cod survival in the Scotian Shelf',
  'Piloting a collaborative project with Mi\'kmaw communities to integrate traditional ecological knowledge with scientific monitoring of coastal ecosystems',
  'Organizing OceanHack 2027, a hackathon bringing together marine scientists and software developers to build open-source tools for ocean conservation',
  'Co-developing a machine learning pipeline with the Bedford Institute of Oceanography for automated plankton classification from continuous imaging data',
]; // 25 = max for project

const FULL_TRANSIENT_FACTS = [
  // Short atomic facts
  'Tracking red tide bloom along the Florida Gulf Coast',
  'Interested in James Webb telescope ocean world findings',
  'Following EU fishing quota negotiations for 2027',
  'Researching Ocean Conservancy grant opportunities',
  'Looking into waterproof drones for reef surveys',
  'Monitoring invasive green crab spread in Nova Scotia',
  'Following the Coral Triangle Initiative summit outcomes',
  'Interested in new eDNA metabarcoding techniques',
  'Tracking NOAA budget allocation for 2027 fiscal year',
  'Researching portable mass spectrometers for field use',
  'Following the Southern Ocean whale population recovery',
  'Interested in starlink maritime connectivity options',
  'Monitoring sea surface temperature anomalies in the North Atlantic',
  'Tracking microplastic legislation progress in the EU parliament',
  'Following developments in autonomous underwater glider tech',
  'Researching acoustic deterrent devices for marine mammals',
  'Interested in kelp farming as a carbon sequestration method',
  'Monitoring the spread of invasive lionfish in Nova Scotia waters',
  'Following the debate on deep-sea mining moratoriums',
  'Tracking ocean acidification measurements in the Bay of Fundy',
  'Interested in bioplastic alternatives for fishing equipment',
  'Researching satellite-based ocean color monitoring advances',
  'Following the North Atlantic right whale calving season',
  'Monitoring Antarctic ice shelf stability reports',
  'Interested in citizen science platforms for marine data',
  'Tracking UNESCO marine world heritage site nominations',
  'Researching underwater acoustic communication protocols',
  'Following developments in tidal energy harvesting in NS',
  'Interested in 3D-printed artificial reef structures',
  'Monitoring water quality reports for Halifax harbour',
  'Following the Arctic shipping route debate',
  'Tracking new marine protected area designations in Canada',
  'Interested in bioluminescence research for sensor applications',
  'Researching low-cost conductivity sensors for estuaries',
  'Following updates on the Ocean Decade research priorities',
  'Monitoring seabird population trends on Sable Island',
  'Tracking offshore wind farm environmental impact studies',
  'Interested in biorock technology for reef restoration',
  'Researching grant deadlines for SSHRC ocean literacy projects',
  'Following the latest krill population surveys in the Southern Ocean',
]; // 40 = max for transient

// Helper: assert length compliance and category counts for a fact sheet
function assertSheetQuality(
  sheet: Array<{ category: string; fact: string }>,
  label: string,
  minCounts: Record<string, number>,
) {
  const byCat: Record<string, number> = {};
  const violations: string[] = [];

  console.log(`[TEST] ${label}: ${sheet.length} facts`);
  for (const entry of sheet) {
    byCat[entry.category] = (byCat[entry.category] || 0) + 1;
    const len = entry.fact.length;
    console.log(`  [${entry.category}] (${len} chars) ${entry.fact}`);
    if (len > MAX_FACT_CHARS) {
      violations.push(`[${entry.category}] (${len} chars) ${entry.fact}`);
    }
  }

  if (violations.length > 0) {
    console.log(`[TEST] VIOLATIONS (>${MAX_FACT_CHARS} chars):`);
    for (const v of violations) console.log(`  ${v}`);
  }

  // Hard fail on anything over 150
  const hardViolations = sheet.filter(e => e.fact.length > 150);
  expect(hardViolations.length).toBe(0);

  // At least 80% under limit
  const underLimit = sheet.filter(e => e.fact.length <= MAX_FACT_CHARS);
  const rate = underLimit.length / sheet.length;
  console.log(`[TEST] Compliance: ${underLimit.length}/${sheet.length} (${(rate * 100).toFixed(0)}%) under ${MAX_FACT_CHARS} chars`);
  expect(rate).toBeGreaterThanOrEqual(0.8);

  // No category should exceed its max
  for (const [cat, max] of Object.entries(CATEGORY_MAX_FACTS)) {
    if (byCat[cat]) {
      expect(byCat[cat]).toBeLessThanOrEqual(max);
    }
  }

  // Category counts should stay near capacity — not over-dropped
  console.log(`[TEST] Counts: core=${byCat.core || 0} technical=${byCat.technical || 0} project=${byCat.project || 0} transient=${byCat.transient || 0}`);
  for (const [cat, min] of Object.entries(minCounts)) {
    expect(byCat[cat] || 0).toBeGreaterThanOrEqual(min);
  }
}

test.describe('Fact Sheet Length Limits', () => {
  test.describe.configure({ mode: 'serial' });

  test('qwen merge: max-capacity sheet with new facts', async ({ page, request }) => {
    test.setTimeout(300_000);

    const user = await setupPageWithUser(page);

    // Seed a fact sheet at full production-like capacity (30+25+25+40 = 120 facts)
    // Includes deliberately long compound entries (>120 chars) like real production
    seedFactSheet(user.id, [
      ...FULL_CORE_FACTS.map(f => ({ category: 'core', fact: f })),
      ...FULL_TECHNICAL_FACTS.map(f => ({ category: 'technical', fact: f })),
      ...FULL_PROJECT_FACTS.map(f => ({ category: 'project', fact: f })),
      ...FULL_TRANSIENT_FACTS.map(f => ({ category: 'transient', fact: f })),
    ]);

    // Conversation adds new facts across ALL four categories so every category goes through the model.
    // The qwen merge skips categories with no new facts, so we must touch all of them.
    seedChatMessages(user.id, [{
      title: 'Lab Updates',
      messages: [
        // core: personal life updates
        { role: 'user', content: 'Theo just won the provincial chess championship! And I got invited to give a keynote at the Ocean Sciences Meeting in New Orleans next February.' },
        { role: 'assistant', content: 'Congratulations on both fronts!' },
        // technical: new tools
        { role: 'user', content: 'I started learning Rust to rewrite our acoustic processing pipeline. Also switching from PostgreSQL to DuckDB for analytical workloads.' },
        { role: 'assistant', content: 'Rust would be a significant speed improvement for audio processing.' },
        // project: new initiative
        { role: 'user', content: 'We just got funding to start a seagrass mapping project in Mahone Bay. I will be leading it starting next month.' },
        { role: 'assistant', content: 'That is a great area for seagrass restoration work.' },
        // transient: current interests
        { role: 'user', content: 'Have you seen the news about the massive coral bleaching event in the Great Barrier Reef? I am following it closely.' },
        { role: 'assistant', content: 'Yes, it has been widely reported this month.' },
      ],
    }]);

    const headers = { Cookie: `auth-token=${user.token}` };
    const extractResponse = await request.post('http://localhost:3001/api/facts/extract', { headers });
    const extractResult = await extractResponse.json();
    expect(extractResponse.ok()).toBeTruthy();
    expect(extractResult.state).toBe('succeeded');

    const sheet = await getFactSheetViaApi(request, headers);
    expect(sheet).not.toBeNull();

    // After hard filter: core keeps 23 short (7 long dropped), technical keeps 17 (8 dropped),
    // project keeps 15 (10 dropped), transient keeps all 40. Model may add a few new ones.
    assertSheetQuality(sheet!, 'Qwen merge (max capacity)', {
      core: 20,        // 23 short survive filter + model may add new
      technical: 15,   // 17 short survive + model may add new from conversation
      project: 10,     // 15 short survive (some categories may not get new facts)
      transient: 35,   // all 40 short survive
    });
  });

  test('qwen merge: full technical with new arrivals', async ({ page, request }) => {
    test.setTimeout(300_000);

    const user = await setupPageWithUser(page);

    // All categories at max capacity
    seedFactSheet(user.id, [
      ...FULL_CORE_FACTS.map(f => ({ category: 'core', fact: f })),
      ...FULL_TECHNICAL_FACTS.map(f => ({ category: 'technical', fact: f })),
      ...FULL_PROJECT_FACTS.map(f => ({ category: 'project', fact: f })),
      ...FULL_TRANSIENT_FACTS.map(f => ({ category: 'transient', fact: f })),
    ]);

    // Conversation touches all 4 categories — heavy on technical + some for each other
    seedChatMessages(user.id, [{
      title: 'New Tech Stack',
      messages: [
        // technical: many new tools
        { role: 'user', content: 'I just switched from MATLAB to Julia for all signal processing. Also started using Weights & Biases for experiment tracking instead of just MLflow.' },
        { role: 'assistant', content: 'Julia is excellent for numerical computing.' },
        { role: 'user', content: 'And we migrated from Nextcloud to Syncthing for the team. I also set up a Prometheus monitoring stack to replace Grafana standalone.' },
        { role: 'assistant', content: 'Syncthing is great for peer-to-peer sync.' },
        { role: 'user', content: 'Oh and I bought a Bambu Lab A1 for printing custom underwater enclosures. Plus started using Obsidian for all my research notes instead of plain text files.' },
        { role: 'assistant', content: 'Nice upgrades across the board!' },
        // core: personal update
        { role: 'user', content: 'David just got promoted to senior engineer at his firm. We are celebrating this weekend.' },
        { role: 'assistant', content: 'That is wonderful news!' },
        // project: new work
        { role: 'user', content: 'I submitted a proposal for a seal acoustic monitoring study in Sable Island.' },
        { role: 'assistant', content: 'Sable Island would be a great field site for that.' },
        // transient: current event
        { role: 'user', content: 'I am following the new IPCC ocean report that just dropped. Very concerning findings.' },
        { role: 'assistant', content: 'Yes, the projections are alarming.' },
      ],
    }]);

    const headers = { Cookie: `auth-token=${user.token}` };
    const extractResponse = await request.post('http://localhost:3001/api/facts/extract', { headers });
    expect(extractResponse.ok()).toBeTruthy();

    const sheet = await getFactSheetViaApi(request, headers);
    expect(sheet).not.toBeNull();

    assertSheetQuality(sheet!, 'Qwen merge (full + new technical)', {
      core: 20,
      technical: 15,   // 17 short survive filter + model adds new from conversation
      project: 10,
      transient: 35,
    });
  });

  test('gemini rebuild: max-capacity inputs', async ({ page, request }) => {
    test.setTimeout(300_000);

    const user = await setupPageWithUser(page);
    const headers = { Cookie: `auth-token=${user.token}` };

    // Seed raw facts at volume — the rebuild reads all of these
    const rawFacts = [
      ...FULL_CORE_FACTS.map(f => ({ category: 'core', fact: f })),
      ...FULL_TECHNICAL_FACTS.map(f => ({ category: 'technical', fact: f })),
      ...FULL_PROJECT_FACTS.map(f => ({ category: 'project', fact: f })),
      ...FULL_TRANSIENT_FACTS.map(f => ({ category: 'transient', fact: f })),
    ];
    seedFacts(user.id, rawFacts);

    // Seed a qwen sheet (rebuild also reads the latest running sheet)
    seedFactSheet(user.id, [
      ...FULL_CORE_FACTS.map(f => ({ category: 'core', fact: f })),
      ...FULL_TECHNICAL_FACTS.map(f => ({ category: 'technical', fact: f })),
      ...FULL_PROJECT_FACTS.map(f => ({ category: 'project', fact: f })),
      ...FULL_TRANSIENT_FACTS.map(f => ({ category: 'transient', fact: f })),
    ], 'qwen');

    // Trigger the Gemini daily rebuild
    await triggerRebuildJob(request, headers);

    const sheet = await getFactSheetViaApi(request, headers, 'gemini');
    expect(sheet).not.toBeNull();

    assertSheetQuality(sheet!, 'Gemini rebuild (max capacity)', {
      core: 20,
      technical: 15,
      project: 10,
      transient: 30,
    });
  });
});
