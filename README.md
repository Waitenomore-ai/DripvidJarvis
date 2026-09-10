# DripVid JARVIS

Standalone localhost-only JARVIS operator service for DripVid.

## Development

Requires Node.js 22+.

Commands:
- npm install
- npm test
- npm run check
- npm start

Default interface: http://127.0.0.1:3342/

## Dependencies

- DripVid: http://127.0.0.1:3000
- MCP: http://127.0.0.1:8788/mcp
- AI-HQ: http://127.0.0.1:9001

## Safety

JARVIS remains bound to localhost during this milestone.
Read-only operations may execute directly.
Mutating operations require an expiring single-use confirmation.
Unknown AI-HQ tool requests are rejected.
Secrets must only be supplied through environment variables.

## API

- GET /api/health
- GET /api/tools
- GET /api/confirmations
- POST /api/conversation
- POST /api/confirm

## Deployment

Planned production directory: /opt/dripvid-jarvis
Example systemd unit: deploy/dripvid-jarvis.service
Do not expose port 3342 publicly.
No production deployment or nginx modification is automatic.
