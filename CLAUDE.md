# Brain

A personal knowledge and chat application built with Next.js.

## Skills

When working on specific topics, read the relevant skill documentation:

- **Getting Started**: [.agent/skills/getting_started/SKILL.md](.agent/skills/getting_started/SKILL.md) - Setting up and running the app locally
- **AI Providers**: [.agent/skills/ai_providers/SKILL.md](.agent/skills/ai_providers/SKILL.md) - Adding new AI models and providers
- **Ollama**: [.agent/skills/ollama/SKILL.md](.agent/skills/ollama/SKILL.md) - Local Ollama integration, tool handling, and small model workarounds
- **Job System**: [.agent/skills/job_system/SKILL.md](.agent/skills/job_system/SKILL.md) - Background job processing with streaming
- **E2E Testing**: [.agent/skills/e2e_testing/SKILL.md](.agent/skills/e2e_testing/SKILL.md) - Playwright testing patterns
- **Running E2E Tests**: [.agent/skills/running_e2e/SKILL.md](.agent/skills/running_e2e/SKILL.md) - Setting up and running E2E tests locally
- **Auth & Routing**: [.agent/skills/auth_routing/SKILL.md](.agent/skills/auth_routing/SKILL.md) - Authentication and routing with proxy.ts
- **Location Tracking**: [.agent/skills/location_tracking/SKILL.md](.agent/skills/location_tracking/SKILL.md) - Geolocation with smart caching for chat and highlights
- **Step Limit Handling & Compaction**: [.agent/skills/step_limit_handling/SKILL.md](.agent/skills/step_limit_handling/SKILL.md) - Infinite tool loop, context compaction, crash recovery, and observer summaries
- **Tools**: [.agent/skills/tools/SKILL.md](.agent/skills/tools/SKILL.md) - AI tool/function calling system and adding new tools
- **Tool Call Logging**: [.agent/skills/tool_call_logging/SKILL.md](.agent/skills/tool_call_logging/SKILL.md) - Logging tool calls, compact context interleaving, and retrieve_tool_responses patterns
- **Job-Backed Tools**: [.agent/skills/job_backed_tools/SKILL.md](.agent/skills/job_backed_tools/SKILL.md) - Long-running tools via child jobs, live SSE output, persistence, and resume patterns
- **Fact Extraction**: [.agent/skills/fact_extraction/SKILL.md](.agent/skills/fact_extraction/SKILL.md) - Automatic fact extraction from conversations, storage, context injection, and periodic worker
- **Fact Sheet**: [.agent/skills/fact_sheet/SKILL.md](.agent/skills/fact_sheet/SKILL.md) - Scored fact sheet generation, scoring algorithm, assembly, and context injection
- **Recent Conversations**: [.agent/skills/recent_conversations/SKILL.md](.agent/skills/recent_conversations/SKILL.md) - Bridging the gap between conversations and fact extraction
- **Image Upload**: [.agent/skills/image_upload/SKILL.md](.agent/skills/image_upload/SKILL.md) - Local image upload with WebP conversion for docs
- **RAG Fact Search**: [.agent/skills/rag_fact_search/SKILL.md](.agent/skills/rag_fact_search/SKILL.md) - Semantic search over facts using Ollama embeddings and sqlite-vec
- **Search Tools**: [.agent/skills/search_tools/SKILL.md](.agent/skills/search_tools/SKILL.md) - AI search tools for facts, conversations, and within-conversation messages
- **User Management**: [.agent/skills/user_management/SKILL.md](.agent/skills/user_management/SKILL.md) - Creating and managing users
- **Database**: [.agent/skills/database/SKILL.md](.agent/skills/database/SKILL.md) - SQLite database setup, schema, modules, and configuration
- **Deploy**: [.agent/skills/deploy/SKILL.md](.agent/skills/deploy/SKILL.md) - Deploying to a remote server
- **Local Deployment**: [.agent/skills/local_deployment/SKILL.md](.agent/skills/local_deployment/SKILL.md) - Deploying OkBrain on a local Mac with a Linux VM
- **Mobile Install**: [.agent/skills/mobile_install/SKILL.md](.agent/skills/mobile_install/SKILL.md) - Installing the app on mobile as a PWA or iPhone shortcut
- **Sync Brain to OkBrain**: [.agent/skills/sync-brain-to-okbrain/SKILL.md](.agent/skills/sync-brain-to-okbrain/SKILL.md) - Sync all files from brain into OkBrain and create a single commit in OkBrain
- **DB Maintenance**: [.agent/skills/db_maintenance/SKILL.md](.agent/skills/db_maintenance/SKILL.md) - Analyzing and reducing database size, purging old job events
- **macOS Network Watchdog**: [.agent/skills/macos_network_watchdog/SKILL.md](.agent/skills/macos_network_watchdog/SKILL.md) - Automatic Wi-Fi failover to iPhone USB on the MacBook Pro
- **Backup**: [.agent/skills/backup/SKILL.md](.agent/skills/backup/SKILL.md) - Daily backup of Brain VM data to MacBook Pro host
- **File Browser**: [.agent/skills/file_browser/SKILL.md](.agent/skills/file_browser/SKILL.md) - Sidebar file browser for browsing and editing sandbox files
- **Apps**: [.agent/skills/apps/SKILL.md](.agent/skills/apps/SKILL.md) - App system with isolated sandbox, secrets, AI tools, and README-driven development

## Key Directories

- `src/app/` - Next.js App Router pages and API routes
- `src/lib/` - Core libraries (db, auth, jobs, AI providers)
- `src/components/` - React components
- `src/workers/` - Background job workers
- `e2e/` - End-to-end tests

## Commands

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run test:e2e` - Run all E2E tests
- `npm run test:e2e -- e2e/specific.spec.ts` - Run specific test file
- `npm run test:smoke` - Run smoke tests (~12 tests, ~30s)
- `./scripts/test-group.sh <group>` - Run a named test group (chat, docs, providers, etc.)
- `./scripts/test-affected.sh` - Run tests affected by current changes

## Database

Uses SQLite with `better-sqlite3` (local) / SQLite Cloud (production). See the [Database skill](.agent/skills/database/SKILL.md) for details.
