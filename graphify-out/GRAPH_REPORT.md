# Graph Report - hobi  (2026-10-23)

## Corpus Check
- 511 files · ~1,155,478 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 166 file(s) not represented in the graph (top: .meta 91, .bkp 37, .1 20)

## Summary
- 3048 nodes · 6915 edges · 168 communities (146 shown, 22 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 27 edges (avg confidence: 0.88)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `475cfff6`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Input
- getSocket
- db/index.ts
- WallFeed.tsx
- Avatar
- dependencies
- cn
- Button
- package.json
- App.tsx
- ref_react
- legacy-import-apply.cjs
- Hardening Controls
- schema.ts
- sidebar.tsx
- lib/utils.ts
- roomHandlers.ts
- vite-socket-io.ts
- Code Review and Quality
- Test-Driven Development
- api/package.json
- Context Engineering
- redis.ts
- legacy-rebuild-from-dump.cjs
- global-media.ts
- legacy-import-dry-run.cjs
- Git Workflow and Versioning
- Optimization Patterns
- wallService.ts
- Shipping and Launch
- API and Interface Design
- Browser Testing with DevTools
- Frontend UI Engineering
- dotenv
- legacy-normalize-performance.cjs
- CI/CD and Automation
- Constraint-Driven Development
- Deprecation and Migration
- devDependencies
- permissionEngine.ts
- Documentation and ADRs
- Incremental Implementation
- compilerOptions
- form.tsx
- chatStore.ts
- adminPermissions.ts
- authService.ts
- constants.ts
- Debugging and Error Recovery
- ref_node_crypto
- uploadStorage.ts
- profileService.ts
- app.module.ts
- devDependencies
- EventEnvelope.ts
- profileHandlers.ts
- fileService.ts
- compilerOptions
- EventBus.ts
- SocketBroker.ts
- storyService.ts
- Interview Me
- Planning and Task Breakdown
- compilerOptions
- presenceIntelligence.ts
- image-compress.ts
- ReOrder: Keep Your Regulars Ordering Direct
- Idea Refine
- Code Simplification
- components.json
- Distributed Realtime Social Infrastructure
- adminConfigService.ts
- legacyAdminService.ts
- requestCountry.ts
- PermissionsMatrix.tsx
- Doubt-Driven Development
- Process
- stories-store.ts
- workers/index.ts
- compilerOptions
- Using Agent Skills
- web/package.json
- خطة بناء منصة دردشة عالمية
- scripts
- class-variance-authority
- carousel.tsx
- socket/index.ts
- Spec-Driven Development
- Source-Driven Development
- scripts
- command.tsx
- services/presenceManager.ts
- voiceStageHandlers.ts
- presenceManager
- Refinement & Evaluation Criteria
- pg
- chart.tsx
- notificationService.ts
- privateMessageService.ts
- userRepository.ts
- compilerOptions
- next
- apply-dark-mode.cjs
- api/README.md
- db-server.cjs
- تقرير خطة الترحيل الفعلي
- giftService.ts
- pagination.tsx
- The Simplification Process
- Ideation Frameworks Reference
- jest
- devDependencies
- الاستفادة من قاعدة Safari القديمة
- minioClient.ts
- navigation-menu.tsx
- إصلاحات أمنية مقترحة
- userProfileDefaults.ts
- YouTubeSearch.tsx
- sheet.tsx
- realtimeEventEngine
- eslint.config.js
- تقرير الترحيل التجريبي
- legacy-import-prepare-schema.cjs
- idempotencyManager
- server.ts
- سياسة رسائل الغرف والخاص
- backfill-users.cjs
- getDeviceSignature
- Nitro Server Layer
- nest-cli.json
- dependencies
- dependencies
- CQRS Flow
- مصفوفة مطابقة قاعدة Safari القديمة
- input-otp.tsx
- migrate.ts
- wall/upload.post.ts
- sharedUserStore.ts
- scripts
- تغطية أعمدة قاعدة Safari القديمة
- ref_node_path
- accordion.tsx
- tsconfig.build.json
- web/eslint.config.mjs
- web/README.md
- layout.tsx
- Legacy normalization report
- Legacy schema rebuild
- cleanup-orphaned-rows.cjs
- create-safarihost-admin.cjs
- legacy-import-reconcile.cjs
- src/utils/supabase/client.ts
- create-admin-user.cjs
- legacy-db-status.cjs
- batch-stats.get.ts
- vercel.json
- idea-refine.sh
- AGENTS.md
- postcss.config.mjs
- README.md

## God Nodes (most connected - your core abstractions)
1. `cn()` - 233 edges
2. `h3` - 142 edges
3. `dbPool` - 127 edges
4. `lucide-react` - 94 edges
5. `Button` - 93 edges
6. `Input` - 69 edges
7. `getSocket()` - 66 edges
8. `getAdminContext()` - 53 edges
9. `Card` - 47 edges
10. `CardContent` - 47 edges

## Surprising Connections (you probably didn't know these)
- `CQRS Flow` --references--> `JoinRoomCommand`  [INFERRED]
  docs/distributed-social-infrastructure.md → server/commands/JoinRoomCommand.ts
- `Event Flow Architecture` --references--> `EventEnvelope`  [INFERRED]
  docs/distributed-social-infrastructure.md → server/core/events/EventEnvelope.ts
- `CQRS Flow` --references--> `FollowUserCommand`  [INFERRED]
  docs/distributed-social-infrastructure.md → server/commands/FollowUserCommand.ts
- `CQRS Flow` --references--> `SendMessageCommand`  [INFERRED]
  docs/distributed-social-infrastructure.md → server/commands/SendMessageCommand.ts
- `Distributed Scaling Plan` --references--> `workerRuntime`  [INFERRED]
  docs/distributed-social-infrastructure.md → server/workers/WorkerRuntime.ts

## Import Cycles
- 3-file cycle: `server/services/filterService.ts -> server/socket/index.ts -> server/socket/roomHandlers.ts -> server/services/filterService.ts`
- 3-file cycle: `server/services/filterService.ts -> server/socket/index.ts -> server/socket/wallHandlers.ts -> server/services/filterService.ts`
- 3-file cycle: `server/services/filterService.ts -> server/socket/index.ts -> server/socket/privateHandlers.ts -> server/services/filterService.ts`

## Communities (168 total, 22 thin omitted)

### Community 0 - "Input"
Cohesion: 0.09
Nodes (62): BanCreateModal(), BanCreateModalProps, SearchedUser, BansSection(), AddFilterDialog(), AddFilterDialogProps, LegacyCpSection(), LegacyCpSectionProps (+54 more)

### Community 1 - "getSocket"
Cohesion: 0.08
Nodes (56): DashboardMembers(), MemberStats, OnlineMember, STATUS_COLORS, DashboardRooms(), LAYOUT_ICONS, Room, Frame (+48 more)

### Community 2 - "db/index.ts"
Cohesion: 0.10
Nodes (7): h3, DeadLetterEntry, checkDatabaseConnection(), dbPool, pool, ADMIN_ROLES, getAdminContext()

### Community 3 - "WallFeed.tsx"
Cohesion: 0.07
Nodes (57): EMOJI_CATEGORIES, EMOJI_KEYWORDS, EmojiPanel(), EmojiPanelProps, EmojiPickerPopover(), EmojiPickerPopoverProps, normalizePrivateMessage(), PendingMedia (+49 more)

### Community 4 - "Avatar"
Cohesion: 0.07
Nodes (58): BotsList(), getStoredUser(), Gift, GiftStore(), TopGift, ComposeForm(), getStoredUser(), InternalMail() (+50 more)

### Community 5 - "dependencies"
Cohesion: 0.03
Nodes (69): dependencies, class-variance-authority, clsx, cmdk, date-fns, drizzle-orm, embla-carousel-react, emoji-picker-react (+61 more)

### Community 6 - "cn"
Cohesion: 0.06
Nodes (51): @radix-ui/react-context-menu, @radix-ui/react-dropdown-menu, @radix-ui/react-menubar, vaul, CardDescription, ContextMenuCheckboxItem, ContextMenuContent, ContextMenuItem (+43 more)

### Community 7 - "Button"
Cohesion: 0.18
Nodes (36): AccessLogsSection(), AuditLogsSection(), BanStatCard(), ModerationSection(), RoleRow, RolesSection(), BotsAdminSection(), DatabaseSection() (+28 more)

### Community 8 - "package.json"
Cohesion: 0.04
Nodes (48): sql, eslint, @eslint/js, globals, react, react-dom, @supabase/ssr, @supabase/supabase-js (+40 more)

### Community 9 - "App.tsx"
Cohesion: 0.07
Nodes (36): next-themes, @radix-ui/react-toast, react-router-dom, @tanstack/react-query, App(), queryClient, ProtectedRoute(), ProtectedRouteProps (+28 more)

### Community 10 - "ref_react"
Cohesion: 0.08
Nodes (35): lucide-react, sonner, AdminDashboard(), AdminDashboardProps, getSectionTranslation(), AnimatedFace, AnimatedFacesSection(), GiftCategory (+27 more)

### Community 11 - "legacy-import-apply.cjs"
Cohesion: 0.08
Nodes (45): applyGifts(), applyMappings(), applyPlan(), applyRoles(), applyRoomBadges(), applyRooms(), applySiteAssets(), applySiteBadges() (+37 more)

### Community 12 - "Hardening Controls"
Cohesion: 0.05
Nodes (42): Broken Access Control, Broken Authentication, Cross-Site Scripting (XSS), Data Classification, Dependency Audit Triage, Destructive Operations on Derived Paths, File Upload Safety, Hardening Patterns (+34 more)

### Community 13 - "schema.ts"
Cohesion: 0.05
Nodes (42): accountRole, accountStatus, animatedFaces, behaviorScores, edgeType, eventReplays, eventSnapshots, eventStore (+34 more)

### Community 14 - "sidebar.tsx"
Cohesion: 0.07
Nodes (32): @radix-ui/react-separator, @radix-ui/react-tooltip, Separator, Sidebar, SidebarContent, SidebarContext, SidebarFooter, SidebarGroup (+24 more)

### Community 15 - "lib/utils.ts"
Cohesion: 0.06
Nodes (25): clsx, @radix-ui/react-checkbox, @radix-ui/react-hover-card, @radix-ui/react-progress, @radix-ui/react-radio-group, @radix-ui/react-scroll-area, @radix-ui/react-slider, react-day-picker (+17 more)

### Community 16 - "roomHandlers.ts"
Cohesion: 0.13
Nodes (28): createRoomInDatabase(), getRoomMessage(), updateRoomMessageReactions(), getConnectedUser(), getDedupedOnlineUsers(), getIOInstance(), getPresenceIdentity(), getRoomKey() (+20 more)

### Community 17 - "vite-socket-io.ts"
Cohesion: 0.12
Nodes (24): socket.io, clearFilterCache(), FilterAction, FilterResult, getRules(), logDetection(), processText(), applyShortcuts() (+16 more)

### Community 18 - "Code Review and Quality"
Cohesion: 0.07
Nodes (29): 1. Correctness, 2. Readability & Simplicity, 3. Architecture, 4. Security, 5. Performance, Change Descriptions, Change Sizing, Code Review and Quality (+21 more)

### Community 19 - "Test-Driven Development"
Cohesion: 0.07
Nodes (29): Browser Testing with DevTools, Common Rationalizations, DAMP Over DRY in Tests, Decision Guide, Discover the Stack First, Name Tests Descriptively, One Assertion Per Concept, Overview (+21 more)

### Community 20 - "api/package.json"
Cohesion: 0.07
Nodes (29): author, description, eslint, @eslint/js, globals, @types/node, typescript, typescript-eslint (+21 more)

### Community 21 - "Context Engineering"
Cohesion: 0.07
Nodes (28): Anti-Patterns, Common Rationalizations, Compress before dropping, Confusion Management, Context Budget Management, Context Engineering, Context Packing Strategies, Level 1: Rules Files (+20 more)

### Community 22 - "redis.ts"
Cohesion: 0.11
Nodes (13): ioredis, EventHandler, traceEvent(), metrics, MetricTags, tagSuffix(), RealtimeSecurityDecision, createNoopRedis() (+5 more)

### Community 23 - "legacy-rebuild-from-dump.cjs"
Cohesion: 0.15
Nodes (28): applyRebuild(), buildCreateTableSql(), buildIndexesSql(), buildIndexExpression(), buildSchemaSql(), convertColumn(), convertDefault(), dropPublicObjects() (+20 more)

### Community 24 - "global-media.ts"
Cohesion: 0.16
Nodes (22): GlobalMediaPlayer(), VideoRenderer(), GlobalVideoPlayer(), GlobalVideoPlayerProps, attachVideoTo(), closeMedia(), currentState, ensureAudioElement() (+14 more)

### Community 25 - "legacy-import-dry-run.cjs"
Cohesion: 0.12
Nodes (27): analyzeJsonColumns(), analyzeMojibake(), buildMappings(), buildMappingSqlPreview(), compareCoverage(), countInsertRows(), COVERAGE_PATH, extractCreateTables() (+19 more)

### Community 26 - "Git Workflow and Versioning"
Cohesion: 0.07
Nodes (26): 1. Commit Early, Commit Often, 2. Atomic Commits, 3. Descriptive Messages, 4. Keep Concerns Separate, 5. Size Your Changes, Branch Naming, Branching Strategy, Change Summaries (+18 more)

### Community 27 - "Optimization Patterns"
Cohesion: 0.07
Nodes (25): Connection Pool Exhaustion, Large Bundle Size, Missing Caching (Backend), Missing Image Optimization (Frontend), N+1 Queries (Backend), Optimization Patterns, Queries That Ignore Their Index, Unbounded Data Fetching (+17 more)

### Community 28 - "wallService.ts"
Cohesion: 0.17
Nodes (21): enrichCommentsWithLikes(), getSocketIp(), createWallComment(), createWallPost(), deleteWallComment(), getCommentCounts(), getCommentLikeCounts(), getLikeCounts() (+13 more)

### Community 29 - "Shipping and Launch"
Cohesion: 0.08
Nodes (25): Accessibility, Code Quality, Common Rationalizations, Documentation, Error Budget Release Gate, Error Reporting, Feature Flag Strategy, Infrastructure (+17 more)

### Community 30 - "API and Interface Design"
Cohesion: 0.08
Nodes (24): 1. Contract First, 2. Consistent Error Semantics, 3. Validate at Boundaries, 4. Prefer Addition Over Modification, 5. Predictable Naming, 6. Honouring an Idempotency Key, API and Interface Design, Common Rationalizations (+16 more)

### Community 31 - "Browser Testing with DevTools"
Cohesion: 0.08
Nodes (24): Accessibility Verification with DevTools, Available Tools, Browser Testing with DevTools, Clean Console Standard, Common Rationalizations, Console Analysis Patterns, Content Boundary Markers, For Network Issues (+16 more)

### Community 32 - "Frontend UI Engineering"
Cohesion: 0.08
Nodes (24): Accessibility (WCAG 2.1 AA), ARIA Labels, Avoid the AI Aesthetic, Color, Common Rationalizations, Component Architecture, Component Patterns, Design System Adherence (+16 more)

### Community 33 - "dotenv"
Cohesion: 0.10
Nodes (4): dotenv, drizzle-orm, db, rooms

### Community 34 - "legacy-normalize-performance.cjs"
Cohesion: 0.17
Nodes (24): apply(), ddlStatements, dropDuplicateIndexes(), duplicateIndexes, getPool(), indexStatements, insertJson(), main() (+16 more)

### Community 35 - "CI/CD and Automation"
Cohesion: 0.08
Nodes (23): Automation Beyond CI, Basic CI Pipeline, Build Cop Role, CI/CD and Automation, CI Optimization, Common Rationalizations, Dependabot / Renovate, Deployment Strategies (+15 more)

### Community 36 - "Constraint-Driven Development"
Cohesion: 0.08
Nodes (22): Adapting it, Contract, Floor guard: reference implementation, Reference (Node, ~stack-agnostic patterns), Common Rationalizations, Constraint-Driven Development, Escalation Path, Loading Constraints (+14 more)

### Community 37 - "Deprecation and Migration"
Cohesion: 0.08
Nodes (23): Adapter Pattern, Code Is a Liability, Common Rationalizations, Compulsory vs Advisory Deprecation, Core Principles, Database Schema Migrations (Expand/Contract), Deprecation and Migration, Deprecation Planning Starts at Design Time (+15 more)

### Community 38 - "devDependencies"
Cohesion: 0.08
Nodes (24): devDependencies, eslint, eslint-config-prettier, @eslint/eslintrc, @eslint/js, eslint-plugin-prettier, globals, jest (+16 more)

### Community 39 - "permissionEngine.ts"
Cohesion: 0.14
Nodes (18): getSecret(), verifySignature(), getSecret(), getUserAuthContext(), verifySignature(), invalidateRoomCache(), ALL_CHILDREN, BasicResource (+10 more)

### Community 40 - "Documentation and ADRs"
Cohesion: 0.09
Nodes (22): ADR Lifecycle, ADR Template, API Documentation, Architecture Decision Records (ADRs), Changelog Maintenance, Common Rationalizations, Document Known Gotchas, Documentation and ADRs (+14 more)

### Community 41 - "Incremental Implementation"
Cohesion: 0.09
Nodes (22): Common Rationalizations, Contract-First Slicing, Implementation Rules, Increment Checklist, Incremental Implementation, Overview, Red Flags, Risk-First Slicing (+14 more)

### Community 42 - "compilerOptions"
Cohesion: 0.09
Nodes (22): compilerOptions, allowSyntheticDefaultImports, baseUrl, declaration, emitDecoratorMetadata, esModuleInterop, experimentalDecorators, forceConsistentCasingInFileNames (+14 more)

### Community 43 - "form.tsx"
Cohesion: 0.10
Nodes (20): @radix-ui/react-label, @radix-ui/react-slot, react-hook-form, Breadcrumb, BreadcrumbEllipsis(), BreadcrumbItem, BreadcrumbLink, BreadcrumbList (+12 more)

### Community 44 - "chatStore.ts"
Cohesion: 0.14
Nodes (18): executeSendMessageCommand(), addMessage(), cacheRoomMessage(), ChatMessage, ChatRoom, cloneRooms(), DEFAULT_ROOMS, getRoomMsgMap() (+10 more)

### Community 45 - "adminPermissions.ts"
Cohesion: 0.21
Nodes (6): AdminPermission, guardAdminAction(), hasPermission(), logAdminAudit(), hasPermission(), invalidatePermissionCache()

### Community 46 - "authService.ts"
Cohesion: 0.17
Nodes (21): createGuestSession(), getSecret(), hashPassword(), issueSession(), issueToken(), loginMember(), normalizeUsername(), persistedToStoredUser() (+13 more)

### Community 47 - "constants.ts"
Cohesion: 0.13
Nodes (20): AdminAction(), AdminCP(), AdminCPProps, NavGroup(), currentLang, FIELD_TRANSLATIONS, FIELD_TRANSLATIONS_AR, FIELD_TRANSLATIONS_EN (+12 more)

### Community 48 - "Debugging and Error Recovery"
Cohesion: 0.09
Nodes (21): Build Failure Triage, Common Rationalizations, Debugging and Error Recovery, Error-Specific Patterns, Instrumentation Guidelines, Overview, Red Flags, Runtime Error Triage (+13 more)

### Community 49 - "ref_node_crypto"
Cohesion: 0.13
Nodes (13): getSecret(), verifySignature(), getSecret(), verifySignature(), getSecret(), verifySignature(), getSecret(), verifySignature() (+5 more)

### Community 50 - "uploadStorage.ts"
Cohesion: 0.15
Nodes (17): ALLOWED_IMAGE, ALLOWED_VIDEO, getSecret(), verifySignature(), getSecret(), verifySignature(), allowedExtensions, getContentType() (+9 more)

### Community 51 - "profileService.ts"
Cohesion: 0.13
Nodes (13): profileVisits, socialEdges, addLocalProfileVisit(), createLegacyProfileResult(), findLegacyUserProfile(), getFollowKey(), getLegacyProfileStats(), localFollowEdges (+5 more)

### Community 52 - "app.module.ts"
Cohesion: 0.17
Nodes (7): AppController, AppModule, AppService, @nestjs/common, @nestjs/core, @nestjs/testing, supertest

### Community 53 - "devDependencies"
Cohesion: 0.10
Nodes (21): devDependencies, autoprefixer, dotenv, drizzle-kit, @dyad-sh/react-vite-component-tagger, eslint, @eslint/js, eslint-plugin-react-hooks (+13 more)

### Community 54 - "EventEnvelope.ts"
Cohesion: 0.17
Nodes (13): deadLetterQueue, eventDispatcher, HandlerRegistration, definitions, EventDefinition, DomainEventPayload, DomainEventType, EventActor (+5 more)

### Community 55 - "profileHandlers.ts"
Cohesion: 0.18
Nodes (19): moderationEvents, userProfiles, users, canExecuteAction(), getPowerLevel(), logModerationEvent(), PowerAction, POWERS_MAP (+11 more)

### Community 56 - "fileService.ts"
Cohesion: 0.16
Nodes (14): ALLOWED_TYPES, createFolder(), deleteFile(), deleteFileFromStorage(), getFilename(), getStorageQuota(), getUploadDir(), listFiles() (+6 more)

### Community 57 - "compilerOptions"
Cohesion: 0.10
Nodes (20): compilerOptions, allowImportingTsExtensions, baseUrl, isolatedModules, jsx, lib, module, moduleDetection (+12 more)

### Community 58 - "EventBus.ts"
Cohesion: 0.17
Nodes (11): JoinRoomCommand, eventBus, REDIS_PUBLISH_RETRIES, REDIS_RETRY_DELAY_MS, REDIS_STREAM_MAXLEN, createEventEnvelope(), EventEnvelope, EventInput (+3 more)

### Community 59 - "SocketBroker.ts"
Cohesion: 0.25
Nodes (9): deleteMail(), getInbox(), getOutbox(), getUnreadCount(), markAsRead(), sendMail(), createNotification(), registerMailHandlers() (+1 more)

### Community 60 - "storyService.ts"
Cohesion: 0.26
Nodes (16): createStory(), deleteStory(), getActiveStories(), getStoryById(), getStoryReactions(), getStoryViewers(), getUserStories(), incrementShareCount() (+8 more)

### Community 61 - "Interview Me"
Cohesion: 0.11
Nodes (18): Common Rationalizations, Example, Interaction with Other Skills, Interview Me, Loading Constraints, Output, Overview, Red Flags (+10 more)

### Community 62 - "Planning and Task Breakdown"
Cohesion: 0.11
Nodes (18): Common Rationalizations, Output Files, Overview, Parallelization Opportunities, Plan Document Template, Planning and Task Breakdown, Red Flags, See Also (+10 more)

### Community 63 - "compilerOptions"
Cohesion: 0.11
Nodes (18): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+10 more)

### Community 64 - "presenceIntelligence.ts"
Cohesion: 0.13
Nodes (11): executeFollowUserCommand(), activityStream, SystemEvent, clampScore(), DetailedStatus, inferPresenceStatus(), PresenceSignal, setPresenceState() (+3 more)

### Community 65 - "image-compress.ts"
Cohesion: 0.18
Nodes (17): FileIcon(), FileItem, FileManager(), FolderIcon(), formatSize(), formatTime(), getStoredUser(), calculateDimensions() (+9 more)

### Community 66 - "ReOrder: Keep Your Regulars Ordering Direct"
Cohesion: 0.11
Nodes (17): Example 1: Vague Early-Stage Concept (Full 3-Phase Session), Example 2: Feature Idea Within an Existing Product (Codebase-Aware), Example 3: Process/Workflow Idea (Non-Product), Ideation Session Examples, Key Assumptions to Validate, MVP Scope, Not Doing (and Why), Open Questions (+9 more)

### Community 67 - "Idea Refine"
Cohesion: 0.11
Nodes (17): Anti-patterns to Avoid, Common Rationalizations, Detailed Instructions, How It Works, Idea Refine, Output, Overview, Phase 1: Understand & Expand (Divergent) (+9 more)

### Community 68 - "Code Simplification"
Cohesion: 0.12
Nodes (16): 1. Preserve Behavior Exactly, 2. Follow Project Conventions, 3. Prefer Clarity Over Cleverness, 4. Maintain Balance, 5. Scope to What Changed, Code Simplification, Common Rationalizations, Language-Specific Guidance (+8 more)

### Community 69 - "components.json"
Cohesion: 0.12
Nodes (16): aliases, components, hooks, lib, ui, utils, rsc, $schema (+8 more)

### Community 70 - "Distributed Realtime Social Infrastructure"
Cohesion: 0.12
Nodes (15): Distributed Realtime Social Infrastructure, Distributed Scaling Plan, Event Flow Architecture, Event Replay Architecture, Feed Ranking Logic, Moderation Pipelines, Observability Architecture, Presence Intelligence Design (+7 more)

### Community 71 - "adminConfigService.ts"
Cohesion: 0.17
Nodes (14): adminAuditLogs, chatBots, moderationFilters, siteSettings, createChatBot(), createModerationFilter(), DEFAULT_BOTS, DEFAULT_CHAT_SETTINGS (+6 more)

### Community 72 - "legacyAdminService.ts"
Cohesion: 0.27
Nodes (12): AdminColumn, assertSafeTableName(), countTableRows(), deleteTableRow(), getPrimaryKeyColumn(), insertTableRow(), isSafeIdentifier(), listAdminColumns() (+4 more)

### Community 73 - "requestCountry.ts"
Cohesion: 0.24
Nodes (8): logAccess(), LogParams, LogState, normalizeCountryCode(), SUPPORTED_COUNTRIES, COUNTRY_HEADER_KEYS, detectCountryCode(), lookupCountryCodeByIp()

### Community 74 - "PermissionsMatrix.tsx"
Cohesion: 0.16
Nodes (15): ACTION_LABELS, BASIC_GROUPS, getActionsForResource(), PermissionGroup, ResourceDef, VISUAL_RESOURCES, ACTION_COLORS, ACTION_SHORT (+7 more)

### Community 75 - "Doubt-Driven Development"
Cohesion: 0.12
Nodes (15): Common Rationalizations, Cross-model escalation, Doubt-Driven Development, Interaction with Other Skills, Loading Constraints, Overview, Red Flags, Step 1: CLAIM — Surface what stands (+7 more)

### Community 76 - "Process"
Cohesion: 0.12
Nodes (15): 1. Define "working" before instrumenting, 2. Pick the right signal for each question, 3. Structured logging, 4. Metrics, 5. Distributed tracing, 6. Alerting, 7. Verify the telemetry itself, Common Rationalizations (+7 more)

### Community 77 - "stories-store.ts"
Cohesion: 0.23
Nodes (12): zustand, StoriesBar(), StoriesBarProps, StoriesViewer(), ViewerOverlay(), ViewersOverlayProps, getStoriesByUser(), getStoryUsers() (+4 more)

### Community 78 - "workers/index.ts"
Cohesion: 0.17
Nodes (10): projectRoomActivity(), calculateFeedScore(), FeedScoreInput, rankFeedEvent(), updateRecommendationSignals(), calculateReputationDelta(), ReputationScore, updateReputationFromEvent() (+2 more)

### Community 79 - "compilerOptions"
Cohesion: 0.12
Nodes (15): compilerOptions, allowImportingTsExtensions, isolatedModules, lib, module, moduleDetection, moduleResolution, noEmit (+7 more)

### Community 80 - "Using Agent Skills"
Cohesion: 0.13
Nodes (14): 1. Surface Assumptions, 2. Manage Confusion Actively, 3. Push Back When Warranted, 4. Enforce Simplicity, 5. Maintain Scope Discipline, 6. Verify, Don't Assume, Core Operating Behaviors, Failure Modes to Avoid (+6 more)

### Community 81 - "web/package.json"
Cohesion: 0.13
Nodes (14): eslint, react, react-dom, @supabase/ssr, @supabase/supabase-js, tailwindcss, @types/node, @types/react (+6 more)

### Community 82 - "خطة بناء منصة دردشة عالمية"
Cohesion: 0.13
Nodes (14): القرار المعماري المقترح, المرحلة 1: تثبيت الأساس, المرحلة 2: مصادقة آمنة, المرحلة 3: دردشة حقيقية, المرحلة 4: قابلية التوسع, المرحلة 5: ميزات اجتماعية, الوضع الحالي, حالة التنفيذ الحالية (+6 more)

### Community 83 - "scripts"
Cohesion: 0.13
Nodes (15): scripts, build, build:dev, db:migrate, db:verify, dev, legacy:create-admin, legacy:dry-run (+7 more)

### Community 84 - "class-variance-authority"
Cohesion: 0.18
Nodes (12): class-variance-authority, @radix-ui/react-toggle, @radix-ui/react-toggle-group, Alert, AlertDescription, AlertTitle, alertVariants, ToggleGroup (+4 more)

### Community 85 - "carousel.tsx"
Cohesion: 0.17
Nodes (14): embla-carousel-react, Carousel, CarouselApi, CarouselContent, CarouselContext, CarouselContextProps, CarouselItem, CarouselNext (+6 more)

### Community 86 - "socket/index.ts"
Cohesion: 0.27
Nodes (11): findInMemoryUser(), updateUserMessageIdentity(), normalizeMinioUrl(), updateCachedWallAuthorProfile(), createSocketServer(), registerPresenceHandlers(), addConnectedUser(), getTotalOnlineCount() (+3 more)

### Community 87 - "Spec-Driven Development"
Cohesion: 0.14
Nodes (13): Common Rationalizations, Keeping the Spec Alive, Overview, Phase 0: Scope Check, Phase 1: Specify, Phase 2: Plan, Phase 3: Tasks, Phase 4: Implement (+5 more)

### Community 88 - "Source-Driven Development"
Cohesion: 0.15
Nodes (12): Common Rationalizations, Overview, Red Flags, Retrieval Safety: Treat Fetched Content as Data, Source-Driven Development, Step 1: Detect Stack and Versions, Step 2: Fetch Official Documentation, Step 3: Implement Following Documented Patterns (+4 more)

### Community 89 - "scripts"
Cohesion: 0.15
Nodes (13): scripts, build, format, lint, start, start:debug, start:dev, start:prod (+5 more)

### Community 90 - "command.tsx"
Cohesion: 0.17
Nodes (12): cmdk, @radix-ui/react-dialog, Command, CommandDialog(), CommandDialogProps, CommandEmpty, CommandGroup, CommandInput (+4 more)

### Community 91 - "services/presenceManager.ts"
Cohesion: 0.17
Nodes (6): addConnectedUser(), connectedUsers, joinRoom(), leaveRoom(), OnlineUser, roomMembers

### Community 92 - "voiceStageHandlers.ts"
Cohesion: 0.26
Nodes (11): normalizeRoomIdValue(), resolveRoomId(), resolveRoomIdVariants(), publishSocketEvent(), getOrCreateRoomStage(), registerVoiceStageHandlers(), roomStages, RoomVoiceStage (+3 more)

### Community 94 - "Refinement & Evaluation Criteria"
Cohesion: 0.17
Nodes (11): 1. User Value, 2. Feasibility, 3. Differentiation, Assumption Audit, Core Evaluation Dimensions, Decision Framework, Might Be True (Nice to Have), Must Be True (Dealbreakers) (+3 more)

### Community 95 - "pg"
Cohesion: 0.18
Nodes (6): pg, getPool(), main(), requiredTables, now, pool

### Community 96 - "chart.tsx"
Cohesion: 0.24
Nodes (11): recharts, ChartConfig, ChartContainer, ChartContext, ChartContextProps, ChartLegendContent, ChartStyle(), ChartTooltipContent (+3 more)

### Community 97 - "notificationService.ts"
Cohesion: 0.35
Nodes (6): getNotifications(), getUnreadCount(), markAllAsRead(), markAsRead(), NotificationType, registerNotificationHandlers()

### Community 98 - "privateMessageService.ts"
Cohesion: 0.32
Nodes (7): buildConversationId(), getConversations(), getMessages(), getUnreadCount(), markConversationRead(), resolveUserKey(), sendPrivateMessage()

### Community 99 - "userRepository.ts"
Cohesion: 0.30
Nodes (11): AuthRole, createPersistedUser(), CreateUserInput, findPersistedUserByUsername(), mapLegacyUser(), markDbUnavailable(), normalizeRole(), PersistedUser (+3 more)

### Community 100 - "compilerOptions"
Cohesion: 0.17
Nodes (11): compilerOptions, allowJs, baseUrl, noImplicitAny, noUnusedLocals, noUnusedParameters, paths, skipLibCheck (+3 more)

### Community 101 - "next"
Cohesion: 0.25
Nodes (6): nextConfig, config, proxy(), getSupabaseConfig(), updateSession(), next

### Community 102 - "apply-dark-mode.cjs"
Cohesion: 0.20
Nodes (3): dir, processDirectory(), replacements

### Community 103 - "api/README.md"
Cohesion: 0.20
Nodes (9): Compile and run the project, Deployment, Description, License, Project setup, Resources, Run tests, Stay in touch (+1 more)

### Community 104 - "db-server.cjs"
Cohesion: 0.27
Nodes (7): pool, query(), readBody(), sendJSON(), server, data, req

### Community 105 - "تقرير خطة الترحيل الفعلي"
Cohesion: 0.20
Nodes (9): التشخيص, الجداول المشمولة, الصلاحيات, الغرف, المستخدمون, الملخص, تقرير خطة الترحيل الفعلي, عينات مراجعة (+1 more)

### Community 106 - "giftService.ts"
Cohesion: 0.29
Nodes (5): getTopGifts(), getUserCoins(), GiftCatalogItem, listGifts(), sendGift()

### Community 107 - "pagination.tsx"
Cohesion: 0.24
Nodes (9): ButtonProps, Pagination(), PaginationContent, PaginationEllipsis(), PaginationItem, PaginationLink(), PaginationLinkProps, PaginationNext() (+1 more)

### Community 108 - "The Simplification Process"
Cohesion: 0.22
Nodes (6): Step 1: Understand Before Touching (Chesterton's Fence), Step 2: Identify Simplification Opportunities, Step 3: Apply Changes Incrementally, Step 4: Verify the Result, The Simplification Process, eventRegistry

### Community 109 - "Ideation Frameworks Reference"
Cohesion: 0.22
Nodes (8): Analogous Inspiration, Constraint-Based Ideation, First Principles Thinking, How Might We (HMW), Ideation Frameworks Reference, Jobs to Be Done (JTBD), Pre-mortem, SCAMPER

### Community 110 - "jest"
Cohesion: 0.22
Nodes (9): jest, collectCoverageFrom, coverageDirectory, moduleFileExtensions, rootDir, testEnvironment, testRegex, transform (+1 more)

### Community 111 - "devDependencies"
Cohesion: 0.22
Nodes (9): devDependencies, eslint, eslint-config-next, tailwindcss, @tailwindcss/postcss, @types/node, @types/react, @types/react-dom (+1 more)

### Community 112 - "الاستفادة من قاعدة Safari القديمة"
Cohesion: 0.22
Nodes (8): الاستفادة من قاعدة Safari القديمة, ترتيب الترحيل المقترح, خريطة التحويل, طبقة منع فقدان المتغيرات, قاعدة العمولة, قاعدة ثابتة للتطوير, ما سنأخذه منها, ما لن ننقله كما هو

### Community 113 - "minioClient.ts"
Cohesion: 0.39
Nodes (6): minio, deleteFromMinio(), getMinioClient(), getMinioPublicUrl(), initMinio(), uploadToMinio()

### Community 114 - "navigation-menu.tsx"
Cohesion: 0.28
Nodes (8): @radix-ui/react-navigation-menu, NavigationMenu, NavigationMenuContent, NavigationMenuIndicator, NavigationMenuList, NavigationMenuTrigger, navigationMenuTriggerStyle, NavigationMenuViewport

### Community 115 - "إصلاحات أمنية مقترحة"
Cohesion: 0.22
Nodes (8): 1. إخفاء Supabase Key (حرج), 2. تحسين escapeHtml و XSS Protection, 3. تحسين showDetails, 4. إضافة Content Security Policy, 5. إضافة Rate Limiting على Client-side, 6. تحسين إدارة التوكن, 7. إضافة Validations على Client, إصلاحات أمنية مقترحة

### Community 116 - "userProfileDefaults.ts"
Cohesion: 0.31
Nodes (5): createUserProfileDefaults(), randomDigits(), randomToken(), UserProfileDefaults, DbProfileRow

### Community 117 - "YouTubeSearch.tsx"
Cohesion: 0.33
Nodes (8): formatDate(), QUICK_SEARCHES, ReelCard(), SearchResult, VideoCard(), VideoModal(), YouTubeSearch(), YTVideo

### Community 118 - "sheet.tsx"
Cohesion: 0.28
Nodes (8): SheetContent, SheetContentProps, SheetDescription, SheetFooter(), SheetHeader(), SheetOverlay, SheetTitle, sheetVariants

### Community 119 - "realtimeEventEngine"
Cohesion: 0.31
Nodes (3): RealtimeEvent, realtimeEventEngine, RealtimeListener

### Community 120 - "eslint.config.js"
Cohesion: 0.32
Nodes (3): eslint-plugin-prettier, eslint-plugin-react-hooks, eslint-plugin-react-refresh

### Community 121 - "تقرير الترحيل التجريبي"
Cohesion: 0.25
Nodes (7): أعداد السجلات, الملخص, تقرير الترحيل التجريبي, فجوات التغطية, فحص JSON, ملاحظة تشغيل, نصوص عربية مشوهة محتملة

### Community 122 - "legacy-import-prepare-schema.cjs"
Cohesion: 0.36
Nodes (7): alterations, ddl, getExistingTables(), getPool(), indexes, main(), parseArgs()

### Community 124 - "server.ts"
Cohesion: 0.38
Nodes (4): createClient(), getSupabaseConfig(), createClient(), getSupabaseConfig()

### Community 125 - "سياسة رسائل الغرف والخاص"
Cohesion: 0.29
Nodes (6): الاستثناءات المسموحة, القرار, سياسة رسائل الغرف والخاص, ماذا يعني ذلك؟, مسار الإنتاج المقترح, ملاحظة مهمة

### Community 126 - "backfill-users.cjs"
Cohesion: 0.29
Nodes (3): argv, client, ids

### Community 127 - "getDeviceSignature"
Cohesion: 0.52
Nodes (6): collectBrowserFingerprint(), generateUUID(), getDeviceId(), getDeviceSignature(), simpleHash(), initDeviceCache()

### Community 128 - "Nitro Server Layer"
Cohesion: 0.33
Nodes (5): API Route Conventions, Nitro Server Layer, Security Rules, Tech Stack, vite.config.ts

### Community 129 - "nest-cli.json"
Cohesion: 0.33
Nodes (5): collection, compilerOptions, deleteOutDir, $schema, sourceRoot

### Community 130 - "dependencies"
Cohesion: 0.33
Nodes (6): dependencies, @nestjs/common, @nestjs/core, @nestjs/platform-express, reflect-metadata, rxjs

### Community 131 - "dependencies"
Cohesion: 0.33
Nodes (6): dependencies, next, react, react-dom, @supabase/ssr, @supabase/supabase-js

### Community 132 - "CQRS Flow"
Cohesion: 0.33
Nodes (4): CQRS Flow, FollowUserCommand, SendMessageCommand, replayEngine

### Community 133 - "مصفوفة مطابقة قاعدة Safari القديمة"
Cohesion: 0.33
Nodes (5): تصحيحات منطقية إلزامية, خريطة الجداول, قاعدة عدم وجود نواقص, مصفوفة مطابقة قاعدة Safari القديمة, معيار اكتمال الترحيل

### Community 134 - "input-otp.tsx"
Cohesion: 0.33
Nodes (5): input-otp, InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot

### Community 135 - "migrate.ts"
Cohesion: 0.60
Nodes (4): ensureRoomBadgesColumns(), ensureUserProfilesColumns(), runAutoMigrations(), verifyDatabaseSchema()

### Community 136 - "wall/upload.post.ts"
Cohesion: 0.40
Nodes (5): ALLOWED_AUDIO, ALLOWED_IMAGE, ALLOWED_VIDEO, getSecret(), verifySignature()

### Community 137 - "sharedUserStore.ts"
Cohesion: 0.53
Nodes (5): addSharedUser(), findSharedUser(), getStore(), removeSharedUser(), SharedUser

### Community 139 - "scripts"
Cohesion: 0.40
Nodes (5): scripts, build, dev, lint, start

### Community 140 - "تغطية أعمدة قاعدة Safari القديمة"
Cohesion: 0.40
Nodes (4): الاستراتيجيات, تغطية أعمدة قاعدة Safari القديمة, تغطية الجداول والأعمدة, ملاحظات تنفيذية

### Community 141 - "ref_node_path"
Cohesion: 0.50
Nodes (3): getPool(), main(), SCHEMA_FILE

### Community 142 - "accordion.tsx"
Cohesion: 0.40
Nodes (4): @radix-ui/react-accordion, AccordionContent, AccordionItem, AccordionTrigger

### Community 143 - "tsconfig.build.json"
Cohesion: 0.50
Nodes (3): exclude, extends, ./tsconfig.json

### Community 145 - "web/README.md"
Cohesion: 0.50
Nodes (3): Deploy on Vercel, Getting Started, Learn More

### Community 148 - "Legacy normalization report"
Cohesion: 0.50
Nodes (3): Legacy normalization report, Operations, Written Rows

### Community 149 - "Legacy schema rebuild"
Cohesion: 0.50
Nodes (3): Legacy schema rebuild, Summary, Tables

### Community 151 - "create-safarihost-admin.cjs"
Cohesion: 0.83
Nodes (3): connection(), hashPassword(), main()

### Community 152 - "legacy-import-reconcile.cjs"
Cohesion: 0.83
Nodes (3): countTable(), getPool(), main()

## Knowledge Gaps
- **59 isolated node(s):** `@nestjs/platform-express`, `reflect-metadata`, `rxjs`, `@eslint/eslintrc`, `@eslint/js` (+54 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 1435 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **22 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `lucide-react` connect `ref_react` to `Input`, `getSocket`, `WallFeed.tsx`, `Avatar`, `cn`, `Button`, `package.json`, `input-otp.tsx`, `App.tsx`, `accordion.tsx`, `lib/utils.ts`, `sidebar.tsx`, `global-media.ts`, `form.tsx`, `constants.ts`, `image-compress.ts`, `PermissionsMatrix.tsx`, `stories-store.ts`, `carousel.tsx`, `command.tsx`, `pagination.tsx`, `navigation-menu.tsx`, `YouTubeSearch.tsx`, `sheet.tsx`?**
  _High betweenness centrality (0.155) - this node is a cross-community bridge._
- **What connects `@nestjs/platform-express`, `reflect-metadata`, `rxjs` to the rest of the system?**
  _59 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Input` be split into smaller, more focused modules?**
  _Cohesion score 0.0853625170998632 - nodes in this community are weakly interconnected._
- **Why does `h3` connect `db/index.ts` to `package.json`, `wall/upload.post.ts`, `vite-socket-io.ts`, `wallService.ts`, `batch-stats.get.ts`, `dotenv`, `permissionEngine.ts`, `chatStore.ts`, `adminPermissions.ts`, `ref_node_crypto`, `uploadStorage.ts`, `fileService.ts`, `SocketBroker.ts`, `storyService.ts`, `adminConfigService.ts`, `legacyAdminService.ts`, `requestCountry.ts`, `notificationService.ts`, `privateMessageService.ts`, `giftService.ts`, `minioClient.ts`?**
  _High betweenness centrality (0.091) - this node is a cross-community bridge._
- **Should `getSocket` be split into smaller, more focused modules?**
  _Cohesion score 0.07792207792207792 - nodes in this community are weakly interconnected._
- **Why does `pg` connect `pg` to `legacy-normalize-performance.cjs`, `db/index.ts`, `db-server.cjs`, `package.json`, `legacy-import-apply.cjs`, `ref_node_path`, `legacy-rebuild-from-dump.cjs`, `cleanup-orphaned-rows.cjs`, `create-safarihost-admin.cjs`, `legacy-import-reconcile.cjs`, `debug-auth.cjs`, `legacy-import-prepare-schema.cjs`, `create-admin-user.cjs`, `legacy-db-status.cjs`, `backfill-users.cjs`?**
  _High betweenness centrality (0.053) - this node is a cross-community bridge._
- **Should `db/index.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.10388127853881278 - nodes in this community are weakly interconnected._