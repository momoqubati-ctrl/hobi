# HOBI P0 SECURITY REMEDIATION BLUEPRINT

**Evidence-First | Strict Read-Only | No Implementation Authorization**  
**Project:** Hobi  
**Repository:** `D:\medo\hobi`  
**Baseline commit observed:** `054fef4eecaa2d7c1a4c7df0d883ba46cf26facb` (`2026-10-30`, `chore: verify voice provider database tables`)

## 1. Executive Summary

This blueprint separates three states that must not be conflated:

- **`COMMITTED_CODE`**: the baseline commit above still contains a REST PM global broadcast.
- **`WORKTREE_CODE`**: the current uncommitted PM route removes that broadcast and calls a targeted publisher, but its identity format does not yet align with socket room registration or persistence. It is not a complete or verified fix.
- **`PRODUCTION_CODE`**: **UNVERIFIED**. No deployment, server, or production request was inspected. Nothing here proves which version is running.

The highest-priority code-level risks are:

1. The committed `/api/pm/send` path publishes message content using `publishGlobalEvent("pm:message", ...)`, and the broker emits that event to the Socket.IO server. This is a **static broadcast finding**, not evidence of a live interception.
2. The PM REST read/list/status routes use caller-supplied identity and conversation parameters. `getMessages` fetches by conversation ID before a participant check and can update read state using the supplied user ID.
3. Internal-mail REST and Socket paths globally publish the mail body. REST sender identity is supplied in the request body; related read/list endpoints likewise accept caller-supplied user IDs.
4. Socket registration joins `user:<id>`, `user:<username>`, and `user:<idreg>`. The previous read-only identity report recorded six duplicate `idreg` groups, so different accounts may share a legacy room.
5. Search endpoints expose internal identity fields; several authentication handlers use separate verifiers or fallback secrets, and logout may act on an unverified caller-supplied ID.

No source remediation, migration, test, database operation, production request, or deployment was performed for this blueprint. The report itself is the requested deliverable.

## 2. Repository Integrity & Existing Changes

### Git snapshot

The initial `git status --short` for this review showed **321 status entries**: 127 tracked paths changed and 194 untracked paths. `git diff --cached --quiet` reported no staged changes. The status was already dirty before this blueprint was created; changes must not be attributed to this task or to a particular author without independent evidence.

The latest read-only status check showed **322 entries**: 127 tracked paths changed and 195 untracked paths; no staged paths. This report is one of the untracked paths. A status check during review briefly showed 323 entries; the fluctuation cannot be attributed from available evidence, so no unrelated path is assumed to belong to this task.

Security-relevant tracked worktree changes observed:

- `server/routes/api/pm/send.post.ts`
- `server/routes/api/pm/upload.post.ts`
- `server/routes/api/auth/me.get.ts`
- `server/services/adminAccess.ts`
- `server/services/authService.ts`
- `server/socket/SocketBroker.ts`
- `server/socket/index.ts`
- `server/socket/callHandlers.ts`
- `server/socket/presenceHandlers.ts`
- `server/socket/presenceManager.ts`
- `server/socket/privateHandlers.ts`
- `server/socket/profileHandlers.ts`
- `server/socket/roomHandlers.ts`
- `server/socket/storyHandlers.ts`
- `server/socket/voiceStageHandlers.ts`
- `server/socket/wallHandlers.ts`
- `server/routes/api/user/frame.post.ts`
- `server/routes/api/user/member-card-bg.post.ts`
- `server/routes/api/users/batch-stats.get.ts`

Relevant untracked paths observed before writing this blueprint:

- `CRITICAL_PRIVATE_MESSAGING_IDENTITY_SECURITY_FINAL_VALIDATION_REPORT.md`
- `server/socket/presenceBridge.ts`
- `tests/privateMessageSecurity.test.ts`
- `tests/presenceBridge.test.ts`

There are many additional unrelated tracked and untracked paths, including generated Graphify output, data/storage artifacts, and other reports/specifications. They were not changed or cleaned up. The full status includes them and should be reviewed before any later commit.

### Material differences between committed and worktree code

| Area | `COMMITTED_CODE` | `WORKTREE_CODE` | Security interpretation |
|---|---|---|---|
| REST PM send | `HEAD` `server/routes/api/pm/send.post.ts:42`: `await publishGlobalEvent("pm:message", socketMessage)`; HEAD then calls targeted sends | Current [send.post.ts](./server/routes/api/pm/send.post.ts#L105) calls the publisher for receiver and sender only | The worktree removes the direct global PM call, but delivery identity, endpoint authorization, ID resolution, deduplication, and actual Socket delivery are not verified. The link opens the worktree file; use the stated HEAD path/line for the committed snippet |
| Socket broker | `HEAD` broker publishes global Redis/local events to `io` | Current broker still supports global fanout for other events and adds a local Vite presence bridge path | Global publishing remains available; no policy prevents future private payloads from using it |
| Socket connection | Committed connection flow accepted handshake user fields | Worktree verifies a signed token with `verifyAuthToken` in `server/socket/index.ts` | Improvement in the worktree; not evidence that production runs it. Role and session revocation remain unresolved |
| PM handlers | Committed code includes in-memory PM handling | Worktree adds chat permission checks to send/reaction handlers | Does not itself fix recipient validation, canonical IDs, read REST IDOR, or REST persistence mismatch |
| Auth | Worktree modifies `authService`, `adminAccess`, and `auth/me` | Several route-local verifiers and fallback secrets remain in current files | Central verifier and session invalidation are not established |

`server/socket/presenceBridge.ts` is untracked and current `SocketBroker` may invoke it when no local user-room recipient exists. This code has not been committed or proven to be part of any deployed build. No change in this section is rolled back or staged.

### Previous test-execution incident to disclose

No tests were run for this blueprint. However, the prior task's incomplete attempt ran `tests/privateMessageSecurity.test.ts`:

- First invocation reported 3 passed, 0 failed.
- A later invocation reported 4 passed and 1 failed, then was stopped while still running.
- That test called `getMessages` with an extra mock argument, but the current service accepts only four arguments and uses the imported default `dbPool`. Jiti also loaded `.env`. Thus the test's supposed fake-database isolation was ineffective; the service proceeded through a `SELECT` and attempted an `UPDATE private_messages` for synthetic `conversationId = "member-a:member-b"` and `userId = "observer-id"`.
- The prior command did not preserve the resulting `rowCount` or a completed transaction result. **It is not possible to certify from this evidence that zero rows changed.** This blueprint performs no follow-up query, does not restore data, and makes no claim that the database is unchanged.

This incident is unrelated to proof of a production incident, and does not establish that the referenced synthetic pair matched any row. It does establish that the earlier test was not safely isolated and that its “pass” is not a valid authorization test.

## 3. Confirmed Static Findings

“Confirmed” below means present in the inspected source version. It does not mean exploited or present in production.

| ID | Finding | Source evidence | Runtime status |
|---|---|---|---|
| F-01 | Committed PM REST send globally broadcasts the complete message event | `HEAD` `server/routes/api/pm/send.post.ts:33,42`: payload construction followed by `await publishGlobalEvent("pm:message", socketMessage)`; `HEAD` `server/socket/SocketBroker.ts:40–41`: `target = io; ... target.emit(event, payload)`. Current broker source location: [SocketBroker.ts](./server/socket/SocketBroker.ts#L40) | Static broadcast confirmed in committed code; runtime exposure not tested; production version unknown |
| F-02 | Current worktree no longer directly calls global publish for REST PM | Current [send.post.ts](./server/routes/api/pm/send.post.ts#L91) creates the payload and targets two user IDs at lines 105–109 | Static worktree change only; currently not committed and not proven deployed |
| F-03 | Current PM target identifiers may not match joined rooms | Current REST service normalizes IDs to `uid` ([privateMessageService.ts](./server/services/privateMessageService.ts#L14)); current route publishes using returned `senderId`/`receiverId` fallback at [send.post.ts](./server/routes/api/pm/send.post.ts#L97); Socket channels join using `socket.data.user.id` at [SocketChannels.ts](./server/socket/SocketChannels.ts#L20) | Potential lost delivery or misalignment; no runtime test |
| F-04 | PM recipient lookup accepts legacy keys and chooses one row with `LIMIT 1` | [privateMessageService.ts](./server/services/privateMessageService.ts#L14) accepts `uid`, `id`, `idreg`, username and limits to one result | Static ambiguous-resolution risk; earlier duplicate-idreg counts are from an earlier read-only snapshot |
| F-05 | PM messages REST read does not scope message SELECT to authenticated membership | [messages.get.ts](./server/routes/api/pm/messages.get.ts#L4) takes query IDs; service selects by `conversation_id` at [privateMessageService.ts](./server/services/privateMessageService.ts#L129) before the read-state UPDATE | Static IDOR exposure path; no HTTP request was performed |
| F-06 | PM conversations route logs response objects including last-message content | [conversations.get.ts](./server/routes/api/pm/conversations.get.ts#L14) returns caller-selected user conversations and line 15 serializes result into a log | Static sensitive-log risk; log access/retention not examined |
| F-07 | PM Socket events have mixed authorization quality | `pm:history` checks the current socket identity against conversation participants at [privateHandlers.ts](./server/socket/privateHandlers.ts#L261); send and typing route using client-supplied `toUserId` at lines 122 and 330; reactions check membership at line 350 | Static behavior only |
| F-08 | Internal mail is globally broadcast over REST and Socket | REST [mail/send.post.ts](./server/routes/api/mail/send.post.ts#L8) takes `senderId` from body and globally publishes at line 18; [mailHandlers.ts](./server/socket/mailHandlers.ts#L22) takes sender from socket but globally publishes at line 32 | Static broadcast confirmed in committed and worktree sources; runtime exposure untested |
| F-09 | Mail inbox/outbox/unread/read/delete REST routes accept caller-supplied `userId` | [inbox.get.ts](./server/routes/api/mail/inbox.get.ts#L4), [outbox.get.ts](./server/routes/api/mail/outbox.get.ts#L4), [unread.get.ts](./server/routes/api/mail/unread.get.ts#L4), [read.post.ts](./server/routes/api/mail/read.post.ts#L4), [id].delete.ts](./server/routes/api/mail/%5Bid%5D.delete.ts#L4) | Static identity-spoofing/IDOR paths; no requests performed |
| F-10 | Socket joins include noncanonical `username` and `idreg` keys | [SocketChannels.ts](./server/socket/SocketChannels.ts#L12) joins `user:<id>`, `user:<username>`, and `user:<idreg>` | Static shared-room possibility; no event-specific unauthorized delivery established |
| F-11 | Public search returns `id`, username, profile text, and role | [user/search.get.ts](./server/routes/api/user/search.get.ts#L15) is a public handler without a local auth check; returns selected columns including role | Static disclosure in code; reachability through a deployed server not tested |
| F-12 | Other search/profile handlers have independent verifiers and expose identifiers | [users/search.get.ts](./server/routes/api/users/search.get.ts#L6) and [profile-check.get.ts](./server/routes/api/user/profile-check.get.ts#L5) contain fallback-secret HMAC checks; search returns username/id/idreg at line 33 and profile-check returns `allUserIds` at line 40 | Static verifier and data-minimization findings |
| F-13 | Logout may trust an unverified body identifier | [logout.post.ts](./server/routes/api/auth/logout.post.ts#L10) starts from `body.userId`; only when absent does it decode token payload without signature verification at line 16 | Static forced-logout/identity-spoofing risk |
| F-14 | Authentication verification is duplicated; claims can be stale | Central [authService.ts](./server/services/authService.ts#L150) validates signature and expiration; [adminAccess.ts](./server/services/adminAccess.ts#L22) has a second verifier; route-local fallbacks remain in search/profile/me. `issueToken` signs role claims ([authService.ts](./server/services/authService.ts#L94)); the Socket handshake in [index.ts](./server/socket/index.ts#L66) uses verified claims, including role, while role change/revocation is not checked there | Static inconsistency. Current `authService` rejects a dev secret only in production at lines 52–62; route fallbacks still exist. Production behavior unknown |

## 4. Authentication Middleware Verification

`nitro.config.ts` sets `serverDir: "./server"` ([nitro.config.ts](./nitro.config.ts#L1)). The only source file found under `server/middleware` is [rateLimiter.ts](./server/middleware/rateLimiter.ts#L1). It assigns request categories, counters, and response headers; it does not verify user tokens or bind a route to an account. The rate limiter is not authorization.

This codebase does not show a shared authentication middleware applied to the PM or mail REST handlers. The handlers themselves do not call `getUserAuthContext` or `verifyAuthToken` for the endpoints in findings F-05/F-09. Nitro's build/runtime middleware discovery was not exercised; this is a source inventory, not a deployment-level proof that no external proxy or wrapper exists.

The current PM send handler is an exception: current worktree [send.post.ts](./server/routes/api/pm/send.post.ts#L36) defaults to `getUserAuthContext`, and derives the sender from the returned context at line 90. Its committed version differs, and this worktree behavior is uncommitted.

## 5. PM Broadcast Remediation Design

### Current end-to-end paths

1. [PrivateChat.tsx](./src/components/chat/PrivateChat.tsx#L600) sends Socket `pm:send` with an `otherUser.id` and a `clientId`.
2. When the acknowledgement is absent/unsuccessful, the client tries REST `/api/pm/send` for text-only messages at [PrivateChat.tsx](./src/components/chat/PrivateChat.tsx#L614), reusing `clientId`.
3. Socket [privateHandlers.ts](./server/socket/privateHandlers.ts#L122) uses the authenticated socket sender, but accepts `toUserId` from the client. The handler appends to an in-memory conversation and emits to `social:<toUserId>` and the sender's room at lines 245–249. It does not persist to the same database service as REST.
4. REST committed code persisted through `sendPrivateMessage` and globally published `pm:message`; current worktree code persists through the same service but publishes to two user IDs using `publishSocketEvent`.
5. The broker's global event path is explicit: local mode emits on `io`; Redis subscribers map `pubsub:room:__global__` to `io` in [SocketBroker.ts](./server/socket/SocketBroker.ts#L28).

REST payload fields include message body/text, message ID, conversation ID, sender and recipient identifiers, `readAt`, creation time, `clientId`, and read status. Socket messages additionally can contain sender display name/avatar/colors, media, reply snapshots, and animated effects. Do not put these in any global event, global room, or unredacted logs.

### Required target architecture

1. **One authoritative send service** handles both Socket and REST transports. It receives authenticated `senderUserId` from the verified session/socket and a recipient account reference that it resolves and validates server-side. The client never supplies `senderId`, a Socket room name, or a delivery destination.
2. **Canonical internal identity** is `users.id` for sender, recipient, conversation membership, unread/read state, notifications, and room keys. The existing UID/idreg compatibility layer is not used to route a private event. A legacy recipient key may be accepted only if it resolves to exactly one account; otherwise return a conflict/invalid-recipient response without persisting or publishing.
3. **Server-only participant rooms** use one namespaced key derived from verified `users.id`, e.g. `private-user:<uuid>`. Room membership is registered only from verified claims and a current account lookup. No client command may join a peer's private room. Publish only to sender and recipient rooms; all of a user's authenticated devices naturally join the same account room.
4. **Persist before delivery** and publish only after the database transaction commits. For an offline recipient, the durable message remains available on next authenticated fetch. Delivery/read receipts are participant-scoped and never broadcast globally.
5. **Idempotency for fallback/retry**: scope a client intent key to sender ID and conversation. Enforce uniqueness atomically in the database; a retry with the same key and same request hash returns the existing message, while a changed payload yields conflict. The existing `clientId` is not proof of deduplication: it is returned/broadcast but no persistent unique constraint or common Socket/REST claim was evidenced.
6. **Avoid double unread changes**: only the first committed message intent increments unread; an idempotent retry returns the prior receipt and does not republish or re-notify. Client listeners should deduplicate by durable message ID/idempotency receipt, but server authorization remains the boundary.
7. **Fail visibly on delivery errors**: committed persistence and event-delivery status must be distinct. Do not convert publisher failure into success without an outbox/retry state or an explicit durable-fetch contract.

Current worktree `send.post.ts` is a partial containment change, not complete: it publishes `uid` values while channel registration uses `users.id`; publishes may therefore miss intended sockets. It catches/logs publication errors but still returns a success-shaped response. These issues require correction and focused tests before release.

## 6. PM REST Authorization Design

For every endpoint, derive caller identity from the central verified session, ignore any client-supplied `userId` as an authority, and check conversation participation by matching `users.id` to the canonical participant IDs. Do not use a raw conversation string as proof of membership.

| Endpoint | Current authentication/identity | Membership and client-controlled input | Data/mutation risk | Required change and acceptance |
|---|---|---|---|---|
| `GET /api/pm/messages` | No local auth call. Uses query `conversationId`, `userId`, optional `beforeId` ([messages.get.ts](./server/routes/api/pm/messages.get.ts#L4)) | Service selects by conversation ID without checking caller membership ([privateMessageService.ts](./server/services/privateMessageService.ts#L129)) | Returns bodies and participant IDs; also marks rows read using caller-selected ID | Authenticate; ignore query userId; require participant row with `auth.userId`; bind SELECT and read update to that identity; assert C gets no body and no read mutation |
| `GET /api/pm/conversations` | No local auth call; query userId ([conversations.get.ts](./server/routes/api/pm/conversations.get.ts#L4)) | No trusted identity binding | Returns message previews, other participant and unread counts; logs entire result including last message | Authenticate; derive current ID; return only own conversations; remove message bodies from logs; assert spoofed userId ignored and no private text logged |
| `GET /api/pm/unread` | No local auth call; query userId ([unread.get.ts](./server/routes/api/pm/unread.get.ts#L4)) | Caller chooses account whose count is read | Account activity/count leak | Authenticate and count only `auth.userId`; assert query parameter cannot select another account |
| `POST /api/pm/read` | No local auth call; body includes `conversationId`, `userId` ([read.post.ts](./server/routes/api/pm/read.post.ts#L4)) | Caller chooses both; service updates messages addressed to that user | Unauthorized read-state manipulation by spoofing user identity | Authenticate; derive ID from token; confirm participant; update only that account's received messages in that conversation |
| `GET /api/pm/user` | No local auth call; query userId ([user.get.ts](./server/routes/api/pm/user.get.ts#L4)) | Resolver accepts id/uid/idreg/username and `LIMIT 1` ([user.get.ts](./server/routes/api/pm/user.get.ts#L15)) | Exposes a user's profile/name fields; ambiguous resolution | Decide whether this is public profile lookup or authenticated chat-target lookup. Return an explicit public projection only; resolve to stable internal ID server-side; reject ambiguous legacy keys |
| `POST /api/pm/send` | Committed version does not derive sender from verified auth; current worktree handler does ([send.post.ts](./server/routes/api/pm/send.post.ts#L52)) | Receiver is client-selected (expected as an action target but must be resolved/validated); current resolver accepts ambiguous legacy keys | Persist and fanout, potential duplicate retry; current route's `uid` vs socket ID mismatch | Central auth; resolve recipient to one `users.id`; authorize message/send/block rules; persist idempotently; target only canonical participant rooms; never trust supplied sender or room |
| `POST /api/pm/upload` | Uses `verifyAuthToken` ([upload.post.ts](./server/routes/api/pm/upload.post.ts#L9)) | No conversation target; upload identity derives from token | Upload writes storage, so exclude from any non-isolated test | Align on central verifier and permission policy; test with fake storage/no production egress |

### Service / SQL requirements

- Replace `resolveUserKey` with explicit internal-ID functions. Keep a separately named legacy adapter only where compatibility is required; query all matches and reject non-unique results.
- Every persistent PM query must include an authenticated participant condition. A transaction should lock/verify the conversation participants before returning content or changing `read_at`.
- `beforeId` must be constrained to the same conversation and participant scope; it must not be used to infer access to another message.
- A read operation should change only rows where `receiver_id = authenticated users.id`, and only after participation is confirmed.
- Historical messages currently may store `uid`; this means adopting `users.id` needs a separately reviewed data-compatibility/mapping plan. Do not bulk rewrite historical messages or guess ownership under this blueprint.
- Existing database row-level security or foreign keys were not inspected in this task. No assumption is made that they cover these route paths.

## 7. Internal Mail Remediation Design

### REST and Socket paths

- REST `/api/mail/send` accepts `{senderId, recipientId, text}` from the request and calls `sendMail` without a visible auth check ([send.post.ts](./server/routes/api/mail/send.post.ts#L6)). It then globally publishes `internal_mail` at line 18.
- Socket `mail:send` derives sender from `socket.data.user.id`, accepts a recipient ID, then globally publishes an enriched payload at [mailHandlers.ts](./server/socket/mailHandlers.ts#L12) and line 32.
- `sendMail` persists body and metadata, performs legacy identity joins, and returns both participants' display data and the body ([internalMailService.ts](./server/services/internalMailService.ts#L3)).
- REST inbox/outbox/unread/read/delete accept a caller-supplied userId in query/body; examples: [inbox.get.ts](./server/routes/api/mail/inbox.get.ts#L4), [read.post.ts](./server/routes/api/mail/read.post.ts#L4), [id].delete.ts](./server/routes/api/mail/%5Bid%5D.delete.ts#L4).

### Required design

Use the same canonical send service and `users.id` recipient validation as PM. REST sender is the verified session principal; Socket sender is the verified socket principal. Mail payload is delivered only to sender and recipient private rooms, never through `publishGlobalEvent`. Inbox/outbox/read/delete operations bind their owner to the authenticated principal. Return the minimum UI projection; avoid logging message bodies or full mail objects. Resolve old IDs only under an explicit unique-match compatibility rule.

**Acceptance:** a three-account test proves C receives no mail packet from either transport; forged REST `senderId` has no effect; C cannot list/read/mark/delete A/B mail by replacing userId; multiple devices for B receive the intended event without global delivery.

## 8. Socket Identity Migration Plan

### Current room map

| Room expression | Joined by | Publisher examples | Issue |
|---|---|---|---|
| `room:social:<users.id>` | `joinUserChannels` from authenticated socket data | PM handlers and current REST route (though current REST uses service output) | Suitable target only after all producers use the same canonical ID |
| `room:notifications:<users.id>` | `joinUserChannels` | notification producers | Same UID/ID mismatch risk where producer IDs are legacy |
| `user:<users.id>` | `joinUserChannels`; `callHandlers.join_user` only when supplied ID equals authenticated ID | `publishUserEvent` Redis subscriber targets `user:<id>`; profile/alert code often targets `user:<id>` | Candidate private account room; namespace can collide with legacy key values |
| `user:<username>` | `joinUserChannels` | generic user-event publishers | Mutable/login identifier used as a routing key |
| `user:<idreg>` | `joinUserChannels` | generic user-event publishers | Duplicate legacy values can put multiple accounts in one room |
| `room:<roomId>` | room lifecycle handlers | room-scoped publishers | Must verify membership on each action; separate from personal rooms |
| `admin:realtime`, `moderators_alerts` | role-conditioned joins | admin/moderation publishers | Verify role revocation/connection disconnect behavior |

Evidence: [SocketChannels.ts](./server/socket/SocketChannels.ts#L12), [SocketGateway.ts](./server/socket/SocketGateway.ts#L16), [callHandlers.ts](./server/socket/callHandlers.ts#L74), [SocketBroker.ts](./server/socket/SocketBroker.ts#L86), and representative targeted emits in [profileHandlers.ts](./server/socket/profileHandlers.ts#L298).

### Transition, without mixing identities

1. Inventory each `user:<...>` publisher and classify whether it is private, public, moderation, or presence data. Do not globally remove a legacy room until its non-private consumers are accounted for.
2. Introduce a versioned, type-prefixed account room derived only from verified `users.id` (for example `account:v2:<uuid>`). No `username`, `uid`, or `idreg` alias may join it.
3. Change private producers and consumers together to the v2 room; do not dual-publish private payloads to old rooms as a compatibility measure.
4. During a controlled server/client rollout, old connections remain on legacy non-private channels only. Require reconnect or force-disconnect before granting a v2 room; ensure old sessions cannot inherit a different account's alias room.
5. After monitoring confirms all supported clients use v2, remove legacy private-room joins/publishers. Any legacy key that resolves to multiple accounts is rejected, not routed by `LIMIT 1`.
6. Add tests proving a client-supplied `join_user` value cannot join another account and duplicate idreg fixtures never share a private room.

No live socket map, cluster topology, Redis configuration, or deployed client-version inventory was inspected. The bridge in the untracked worktree must be treated as a separate rollout component and security-reviewed before use.

## 9. Search/JWT/Session Hardening Plan

### Search contract

- Keep truly public member discovery anonymous if product requires it, but expose a deliberately public projection only (e.g. public user ID, public display name, avatar). Do not return `username`, internal `users.id`, `uid`, `idreg`, `role`, or `allUserIds`.
- Separate public discovery from authenticated recipient resolution. A public lookup identifier must be resolved server-side to `users.id`; it is not an authorization credential.
- Put query-size and result-count limits in the endpoint contract; apply a shared-store rate limit where deployment is multi-instance. Rate limiting does not replace authentication or output minimization.
- `/api/users/search` is signed but uses an independent verifier with a fallback secret and returns internal values. Decide whether it is an admin/private API, then require matching authorization and return only fields needed by that caller.
- `/api/user/profile-check` should return only the caller's own profile-check state. Remove `allUserIds`; no user enumeration is required to answer a per-user profile question.

### Token and session contract

1. One server-side verifier handles token parsing, constant-time signature comparison, required claims, token type/audience, and expiry for all REST and Socket entry points. Invalid/missing secrets fail closed. No route-local fallback secret.
2. The token subject is a canonical `users.id`. Role claims may be an issuance hint, not the current authorization source. Sensitive checks read current authoritative account state/permissions or validate a session/authorization version.
3. On role downgrade, account disable/ban, or password/security event, invalidate affected sessions and disconnect Socket sessions. Redis/session-store failure must not silently restore stale privilege.
4. Define explicit logout semantics: current-device logout versus all-device logout. Verify token first; ignore a client-supplied userId. Revoke a session token identifier or increment an account session version; only then disconnect the matching sockets.
5. Treat token expiry at or before current time as expired. The central verifier in current worktree uses `exp <= now` ([authService.ts](./server/services/authService.ts#L179)); some route-local checks use `Date.now() > exp`, and `me`/profile/search do not consistently enforce expiry.
6. Avoid sensitive log content. In particular remove full PM/mail bodies, participant identifiers not required for diagnosis, bearer tokens, and raw profile/session data from logs.

The current worktree's `getUserAuthContext` checks a configured secret and token expiry in `adminAccess.ts`, but it is a separate implementation. `authService` still defines a development fallback secret for non-production contexts. The other route-local fallback verifiers remain. No session registry/revocation mechanism was established by this source review.

`POST /api/auth/login` delegates to `loginMember` ([login.post.ts](./server/routes/api/auth/login.post.ts#L1)); `issueToken` places `sub`, username, and role in the signed token ([authService.ts](./server/services/authService.ts#L94)). Failed-login attempts are logged by the route, but this review did not establish a shared session registry or prove that login throttling is effective across instances. Do not treat the signed role claim as current authorization after a downgrade or ban.

## 10. File-by-File Remediation Matrix

| File(s) / symbol | Current defect or limitation | Planned change | Acceptance test | Main risk / dependency |
|---|---|---|---|---|
| `server/routes/api/pm/send.post.ts` — `createPrivateMessageSendHandler` | Committed global PM broadcast; current worktree targeted publish uses service-normalized IDs and swallows publish errors | Keep publisher strictly participant-scoped; use canonical `users.id` participants and explicit delivery status; use central idempotent send service | A→B event absent at C; retry returns one message/notification | Existing `uid` persistence and client compatibility must be migrated safely |
| `server/services/privateMessageService.ts` — `resolveUserKey`, `getMessages`, `getConversations`, read/count | `LIMIT 1` legacy resolver; no membership in message SELECT; caller ID can select other account; persistent PM key is uid | Separate canonical resolver and legacy adapter; membership-scoped SQL; reject ambiguous legacy IDs; remove sensitive logging from route | C cannot fetch/change A/B messages; duplicate idreg rejected without writes | Historical data may use UID; requires audited compatibility strategy |
| `server/routes/api/pm/messages.get.ts`, `conversations.get.ts`, `unread.get.ts`, `read.post.ts` | Accept userId/conversationId from caller; no local auth check | Authenticate, derive principal from token, validate ownership/participation in service | Spoofed query/body IDs have no effect; nonparticipant receives generic denial | API response semantics may need client updates |
| `server/routes/api/pm/user.get.ts` | Unauthenticated legacy resolver; returns user lookup data; ambiguous `LIMIT 1` | Define public projection or protected recipient lookup; resolve unique target and return canonical ID | lookup cannot return usernames/internal IDs; duplicate key rejected | Product must define public fields; no public-name decision made here |
| `server/socket/privateHandlers.ts` — `pm:send`, typing, read, reaction | Client supplies recipient key; send does not confirm canonical recipient/authorization; typing lacks participant check; in-memory path differs from REST | Validate recipient and conversation membership centrally; dispatch via verified private room; unify persistence/idempotency and event contract | A/B/C packet capture and invalid-recipient tests | PM handler is part of broader Socket lifecycle |
| `server/socket/SocketBroker.ts` — publishers | Global publisher remains general-purpose; current targeted publish can fall back to untracked bridge | Add safe private-account publisher contract and forbid sensitive events on global API by tests/code review; review bridge separately | publisher tests assert audience for local and Redis modes | Redis unavailable/cluster behavior must fail safely or rely on durable fetch |
| `server/socket/SocketChannels.ts`, `SocketGateway.ts`, `socket/index.ts` | Joins username/idreg rooms; current socket claims role from JWT and joins channels | Versioned user-id-only private room; current account/session validation; no client-controlled target join | duplicate idreg accounts never share private rooms; stale/invalid sessions rejected | Coordinated deployment/reconnect plan needed |
| `server/routes/api/mail/send.post.ts`, `mailHandlers.ts` | REST body chooses sender; both transports global-broadcast full mail | Central authenticated sender; recipient validation; target-only mail notifications/events | A/B/C mail isolation and sender spoof test | Mail compatibility/client listeners |
| `server/services/internalMailService.ts`, mail inbox/outbox/read/unread/delete routes | Legacy OR joins and caller-chosen userId | Canonical internal IDs; each operation scoped to verified owner; minimal projection | C cannot read/change A/B mail; old ambiguous IDs rejected | Historical mail keys may be legacy; do not mass-reassign |
| `server/routes/api/user/search.get.ts`, `users/search.get.ts`, admin search | Public/route-specific responses expose username, roles, IDs, idreg | Public field allowlist; require admin auth for internal search; redact identity fields | response-schema tests assert forbidden keys absent | Search clients may depend on old shape |
| `server/routes/api/user/profile-check.get.ts` | Local verifier/fallback, no consistent expiry, returns `allUserIds` | Central verifier; return only caller-owned row; remove enumeration | expired/default-secret rejected; no unrelated IDs returned | Existing consumers may rely on allUserIds; inspect before removal |
| `server/routes/api/auth/login.post.ts`, `auth/me.get.ts`, `logout.post.ts` | Login delegates to token issuance; me has local verifier; logout body ID/payload decoding without verified signature | Central verifier and token issuer; current role/session state; logout derives only verified subject and revokes correct session | invalid/expired token rejected; attacker cannot terminate another user's sessions; role downgrade invalidates existing socket/auth context | Requires session invalidation policy and possibly persistent state |
| `server/services/authService.ts`, `adminAccess.ts` | Separate verifiers, fallback behavior, role claim can be stale | One verifier and authorization context; current role/session version; fail closed | unit tests for expiry, signature, role downgrade, revocation | Token-contract rollout may invalidate existing sessions |
| `server/middleware/rateLimiter.ts`, `nitro.config.ts` | Limiting is not authentication; fallback in-memory store may diverge across instances | Retain only as availability/abuse layer; verify shared-store semantics and proxy IP trust | multi-instance limit test; auth tests independent of limiter | Redis outage policy and trusted proxy configuration |
| `src/components/chat/PrivateChat.tsx`, `PrivateList.tsx`, `Dashboard.tsx` | Socket→REST fallback can produce duplicate UI/unread signals if acknowledgement is lost; frontend filters are not security controls | Deduplicate by durable message identity; update listeners for canonical IDs; never rely on client filter for privacy | simulated timeout/retry results in one displayed message and one unread increment | Client backward compatibility and existing message ID normalization |
| Schema/migration files | Current evidence shows UID-era persistence; no migration is authorized in this blueprint | Any schema/backfill proposal must be separately reviewed and approved; preserve ambiguous history | migration rehearsal only in isolated disposable DB after explicit approval | No production schema writes authorized |

The table is a plan only. No file above was changed by this task.

## 11. Isolated Runtime Test Matrix

All tests below are **proposed only, not run**. Use fake identities, an isolated disposable database with no production URL in process environment, in-memory/fake Redis, blocked outbound network, fake mail/notifications, and test Socket.IO clients. Evidence must capture actual server-side event recipients or received transport packets, not only what a UI chooses to render.

| Test | Setup | Action | Expected result | Required evidence |
|---|---|---|---|---|
| PM isolation | A sender, B recipient, C observer; two devices for B; all test-only | A sends to B through Socket | B's devices receive one authorized payload; C receives no `pm:message` packet | Server room/recipient assertion plus client `onAny`/transport packet capture at C |
| REST fallback isolation | Same A/B/C; simulate dropped Socket ack before client REST fallback | Retry same intent through REST | One durable message, one notification, one unread increment; C gets no packet | DB test fixture row count and idempotency record, publisher recipient log, C raw packet capture |
| Client room spoof | C has valid test token for C | C emits `join_user`, room-name, or target ID for B | Server keeps C in only C's authorized rooms | Inspect server-side adapter room membership before/after; not just client callback |
| PM conversation IDOR | A/B conversation exists in test DB; C is nonparticipant | C requests messages, list, unread, and read using A/B IDs | Generic denial/empty policy as specified; no body and no read-state mutation | HTTP response plus before/after fixture snapshots; spy/assert no unrelated rows selected |
| Ambiguous legacy key | Two fixture accounts share idreg; unique `users.id` values | Submit duplicated idreg as recipient or old lookup key | Reject conflict; no message/publish/notification | Service result and zero insert/publish assertions |
| Mail broadcast and IDOR | A sender, B recipient, C observer; test mail service | Send via REST and Socket; C tries inbox/outbox/read/delete spoofing B's ID | Only A/B receive scoped event; all C requests denied; body absent from C and logs | C transport capture, DB fixture owner-scoping, captured test logger output |
| Multi-device and reconnect | B has devices B1/B2; A sends while B is online/offline and reconnects | Reconnect and request durable history | Each authorized device receives/retrieves once; C never receives; no history loss | Message IDs and delivery receipts from server plus packet captures |
| Token expiry/default secret | Isolated auth config with known test key; expired, malformed, wrong-key, and default-key tokens | Call protected PM/mail/search/profile/Socket paths | All invalid tokens rejected consistently; no DB/service call | HTTP/socket status and dependency call counters |
| Role downgrade/ban/logout | Test session for A; change authoritative role/session version or revoke it | Reuse old HTTP token and established Socket; logout with forged body userId | Old privileged action denied; affected sockets disconnected; forged ID has no effect | Auth-service state and socket disconnect events, no target user's session removal |
| Public search minimization | Fixture users include internal-only fields | Query public search, authenticated internal search, profile-check | Public response contains only approved public fields; no username/role/internal IDs/allUserIds | Exact JSON key allowlist assertion |

These are test design requirements, not results. No actual user, production database, real message, or deployed service should be used.

## 12. Deployment and Rollback Considerations

1. **Containment first:** prioritize removing the committed PM/mail global fanout and blocking PM/mail read IDORs. The current worktree PM route is not sufficient evidence for release; review and test its identity alignment and error semantics.
2. **Separate build and deploy artifacts:** identify the exact commit/build artifact running in each environment before claiming containment. The worktree, commit, and production may differ.
3. **No dual-publication for private content:** during a rolling upgrade, never send a PM/mail body to both old and new rooms. Old clients may reconnect to the new private room only after server-side identity validation.
4. **Compatibility:** retain legacy IDs only at a tightly bounded boundary. For zero or multiple matches, return an explicit non-enumerating error; do not guess or repair historical ownership.
5. **Schema dependency:** any canonical-ID, idempotency, session-revocation, or public-identity schema change requires a separately approved migration plan, backups, isolated rehearsal, and explicit production authorization. No migration file or schema change is included here.
6. **Roll back safely:** a rollback must restore code behavior without reintroducing a global private event. Keep the containment guard in both forward and rollback versions. If a data migration is later approved, use expand/contract and a tested recovery plan; do not reverse-map ambiguous legacy records automatically.
7. **Incident response:** because the prior failed test may have attempted an UPDATE through the configured pool and did not retain the result, the owner should independently review appropriate database audit/log evidence before making claims about that prior operation. This blueprint deliberately performs no verification query.
8. **Operational verification:** after an authorized deployment, test only with isolated A/B/C identities and capture server-side audiences. Monitoring should count event type and delivery outcome without logging message bodies or tokens.

No deployment/restart/reload, production request, database query, test command, migration, or code edit was performed for this blueprint.

## 13. Remaining Product Decisions

No public-identity design is being approved or implemented here. Keep each decision separate:

- Whether `display_name` is a display-only, repeatable value or a unique public lookup name.
- How `topic` is retained during compatibility and which existing client surfaces still read/write it.
- Whether a shared namespace is required between public display names and mention handles.
- The supported `mention_name` scripts, normalization, length, rename frequency, and old-name reuse/retention policy.
- Whether `public_user_id` is adopted and, if so, its lifecycle and public lookup contract.
- Mail and message retention/deletion policy.
- Session policy: logout-this-device vs logout-all-devices, token lifetime, and revocation behavior after role downgrade, ban, or credential change.

The only operational identity principle assumed for this blueprint is the requested target for private authorization/routing: verified `users.id` is the internal principal. This does not settle public names or require a data migration in this task.

## 14. Acceptance Criteria

The remediation is not complete until all of these are demonstrated in isolated environments:

- No PM or private-mail payload is emitted through a global publisher in any transport path.
- REST PM/mail routes derive caller identity from a verified token; user IDs in body/query cannot impersonate an account.
- PM message content, list, read state, unread counts, and mail operations are scoped to authenticated `users.id` and verified ownership/participation.
- No Socket client can join another user's private room, and no username/idreg legacy room carries private payloads.
- Legacy keys with multiple matches are rejected and create no writes, notifications, or events.
- Socket and REST fallback share one durable idempotency intent and produce one message/unread increment on timeout/retry.
- Public search responses do not include private username, role, internal IDs, or user enumeration.
- One central verifier enforces signature, secret configuration, expiry, token type, current role/session state, and revocation consistently.
- Logout cannot accept an arbitrary body userId and invalidates only the intended verified session scope.
- PM/mail message bodies and credentials do not enter application logs.
- Tests capture server-side event audience or raw received packets for C; UI filtering is not accepted as proof.
- Exact deployed artifact is independently identified and verified before making any production-status claim.

## 15. Explicit Execution Authorization Status

```text
STRICT_READ_ONLY: TRUE
CODE_CHANGES: NONE
FILE_MODIFICATIONS: NONE (except this requested standalone report)
MIGRATIONS_CREATED: NONE
MIGRATIONS_APPLIED: NONE
DATABASE_WRITES: NONE during this blueprint task
PRODUCTION_WRITES: NONE
PRODUCTION_REQUESTS: NONE
REAL_USER_MESSAGES: NONE
REAL_USER_DATA_TESTS: NONE during this blueprint task
TESTS_EXECUTED: NONE during this blueprint task
PRODUCTION_STATUS: UNVERIFIED
EXECUTION_AUTHORIZATION: NOT_GRANTED
WAITING_FOR_USER_EXPLICIT_APPROVAL: TRUE
FINAL_STATUS: PARTIAL
```

**Partial** is intentional: source-level remediation work remains unauthorized; production behavior is unknown; the worktree is dirty and not attributable; and the prior test attempt described above leaves the outcome of an attempted synthetic UPDATE unverified. This report is a remediation blueprint, not a security certification or proof that the leak is currently exploitable in production.
