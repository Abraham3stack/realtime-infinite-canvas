# Future Work

This file lists realistic next steps that are not yet implemented.

## 1. Horizontal Realtime Scaling

Current implementation runs a single Socket.IO server process.

Next step:

- add Redis adapter for multi-instance room broadcasting,
- externalize session/room coordination where needed.

## 2. Stronger Conflict Resolution

Current reconnect strategy is server snapshot + offline queue replay.

Next step:

- introduce conflict-aware merge behavior for concurrent offline edits,
- evaluate OT or CRDT only if product requirements justify complexity.

## 3. Replay at Larger History Sizes

Current replay loads ordered room events and reconstructs client-side.

Next step:

- add optional server-side snapshot checkpoints for long-running rooms,
- add retention and archival policy for historical room journals.

## 4. Identity and Permissions

Current authentication is guest-session based.

Next step:

- add persistent user accounts,
- add role-based room permissions (viewer/editor/admin).

## 5. Expanded Test Coverage

Current automated coverage is concentrated in replay engine, event journaling, and object handlers.

Next step:

- add integration tests for room lifecycle and presence flows,
- add end-to-end tests for reconnect and offline queue behavior.

## 6. Operational Hardening

Current repository supports local deployment and development workflows.

Next step:

- add CI pipeline gates for lint/typecheck/build/test,
- add structured observability (logs, metrics, tracing),
- define backup/recovery and migration rollout practices for hosted environments.
