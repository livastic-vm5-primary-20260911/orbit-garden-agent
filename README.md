# Orbit Garden

Zero-login, turn-based browser strategy game for humans and autonomous agents in the same match.

Two to four players, nine rounds each, 5x5 grid, 12-second turn limit. Humans control their seat in the responsive web UI; agents join and move via the documented HTTP/JSON API.

## Run locally

Install Node.js 20+ and run: node server.mjs

Open: http://localhost:8731/

No npm dependencies; server uses only the Node standard library. Create a room, share its invite URL, start with 2-4 seats, and empty seats become bots. Browser state lives in memory for up to 8 hours.

## Rules

Starting at permanent corner home tiles, players claim adjacent neutral tiles (cost 1 energy), fortify owned tiles up to level 3 (cost 1), raid enemy non-home tiles if enough friendly neighbors surround them (cost 2), or harvest 2 energy. Each turn regenerates one energy, max seven. Tiles score two each; fortification levels above one add one point, and center control is worth three bonus points. After nine rounds per player, highest score wins. A missed turn expires after 12 seconds: under eight minutes per match.

## Agent HTTP API

Public machine-readable help: GET /api/docs

- POST /api/games with JSON {"name":"Agent"} to create a room. Response: code, playerId, token, state.
- POST /api/games/CODE/join with {"name":"Bot 9000","type":"agent"} before start, to join.
- POST /api/games/CODE/start with host token and {"totalPlayers":2}; fills remaining spots with bots.
- GET /api/games/CODE with room-scoped Authorization Bearer TOKEN header to read board, turn, scoreboard, legalMoves, replay and log.
- POST /api/games/CODE/move with token and {"action":"claim","pos":5} or {"action":"harvest","pos":null}.
- GET /api/games/CODE/replay returns historical states and log.
- GET /api/health returns health info.

Index positions are 0-24, row-major. Read legalMoves and turnPlayerId before acting. Error 409 means illegal move; 401 means invalid token. Room tokens are randomly generated and unique per seat.

Sample bot commands:
    node public/bot.js NEW
    node public/bot.js ABC123
    ORBIT_SERVER=https://your-instance.example node public/bot.js ABC123

The NEW example demonstrates a full 2-player match between the sample agent and a built-in bot. The sample bot plays the same HTTP API as humans.

## Fairness and architecture

Built with a single Node.js process, no tracking, no monetary stakes, no login, no wallet connect, and no paid hosting dependencies. Room game state lives in memory; data is removed after 8 hours. Both humans and agents are subject to identical energy and board rules. Per-seat move tokens and sanitized player names protect turns. Human inactivity gets a 12-second skip. The move history is replayable. Built-in bots use a heuristic based on claiming center and available enemy raids. Before production deployments, implement persistence, monitoring and abuse limits.

## Tests

Run node test.mjs for API integration and strategy smoke tests.

Built for [Taskmarket](https://taskmarket.dev) bounty TSK-V6J8MSSD, as an original playable prototype. Rewards, judging and onchain escrow are handled by the Taskmarket requester, not by this free game.
