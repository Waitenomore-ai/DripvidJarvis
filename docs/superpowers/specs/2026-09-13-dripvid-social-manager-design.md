# Jarvis DripVid Social Manager Design

## Goal

Add a first-class Social Manager subsystem to DripVid JARVIS. It converts DripVid operational/content events into platform-specific social campaign drafts, recommends audience/timing/platforms, keeps an auditable campaign history, and requires explicit approval before scheduling or future publishing.

## Scope

Initial event types:

- `new_release` — movie or TV title becoming fully playable.
- `channel_added` — new permanent or temporary Live TV channel.
- `outage` — confirmed major service incident.
- `outage_resolved` — confirmed recovery from an outage.
- `service_notice` — planned maintenance, degraded service, known issue, or version/feature notice.
- `seasonal_promotion` — Christmas, Halloween, Valentine, or other timed campaign.

The system MUST NOT create a `new_release` campaign unless the supplied event says the media is playable/ready.

## Priority policy

- P1: outage and service-critical events. Draft immediately and surface for review.
- P2: channel launches, significant releases, major features/version announcements.
- P3: ordinary release promotion and seasonal/weekly promotional work.
- P4: internal/minor changes. Do not automatically create a public campaign.

## Campaign lifecycle

`draft -> approved -> scheduled -> published/failed`

For this first implementation, `published` is reserved for future provider integrations. There is no automatic external publishing. Scheduling stores the approved target time and remains auditable.

Approval rules:

- Campaigns always start in `draft`.
- Scheduling requires status `approved`.
- Public publishing adapters must later require an approved campaign and explicit operator action.
- No generated campaign may bypass approval.

## Platform mapping

Supported platform presets:

- Facebook
- Instagram
- X
- TikTok
- YouTube Community

Examples:

- New release: Instagram, Facebook, X; existing viewers and title/genre fans; same-day early evening after playability verification.
- Channel added: Instagram, Facebook, X, YouTube Community; existing DripVid and Live TV users; late afternoon/early evening after verification.
- Outage: X and Facebook; all active users; immediately.
- Outage resolved: same platforms used for outage; immediately after technical verification.
- Service notice: Facebook and X, optionally Instagram Story later; timing based on urgency.
- Seasonal promotion: Instagram, Facebook, TikTok, YouTube Community; broad/genre audience; start days or weeks before the event and intensify nearer launch.

## Architecture

### `src/social-manager.js`

Owns:

- event validation and classification
- event-to-campaign rules
- platform-specific copy generation using safe deterministic templates
- campaign persistence
- approval and scheduling transitions
- audit entries

Data is stored in a JSON file configured by `JARVIS_SOCIAL_MANAGER_PATH` and defaults under `data/`.

### `src/social-http.js`

Owns the operator-local Social Manager API routes:

- `GET /api/social/rules`
- `GET /api/social/campaigns`
- `POST /api/social/events`
- `POST /api/social/campaigns/:id/approve`
- `POST /api/social/campaigns/:id/schedule`

Unmatched requests are delegated to the existing Jarvis request handler.

### `src/bootstrap.js`

Starts the existing Jarvis runtime and HTTP handler, then wraps that handler with the Social Manager router. This keeps Social Manager inside the same Jarvis process, host, and port without rewriting the established `src/app.js` router.

### `public/social.html`, `public/social.js`, `public/social.css`

A Jarvis-native Social Manager screen providing:

- campaign summary counts
- event-to-campaign creation form
- campaign cards with priority/status/audience/timing
- per-platform generated copy preview
- approval and scheduling controls
- clear notice that external publishing is not connected yet

## Persistence model

Each campaign stores:

- id
- event type and source event payload
- priority
- title
- audience
- recommended timing text
- recommended platforms
- generated platform drafts
- status
- scheduled timestamp (optional)
- created/updated timestamps
- audit entries

The store uses atomic replacement (temporary file then rename) to reduce corruption risk.

## Security and safety

- JARVIS remains bound to its configured host; this design adds no new remote listener.
- No social network credentials are stored in the campaign file.
- No publish action exists in v1.
- Approval is a server-side state transition, not only a UI control.
- Release promotion is gated by playability readiness.
- P4 events may be classified but return no public campaign.

## Future provider adapters

Future phases can add dedicated adapters for Meta Graph API, X API, TikTok Content Posting API, and YouTube Data API. Credentials should be server-side secrets and publishing must preserve the approval gate and audit log.
