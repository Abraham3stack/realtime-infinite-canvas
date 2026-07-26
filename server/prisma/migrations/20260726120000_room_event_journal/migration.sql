-- Add deterministic room event sequencing for append-only replay foundation.
ALTER TABLE "Room"
ADD COLUMN "eventSequenceNumber" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "RoomEvent" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "sequenceNumber" INTEGER NOT NULL,
    "operationId" TEXT NOT NULL,
    "actorSessionId" TEXT NOT NULL,
    "actorDisplayName" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoomEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RoomEvent_roomId_sequenceNumber_key" ON "RoomEvent"("roomId", "sequenceNumber");
CREATE UNIQUE INDEX "RoomEvent_roomId_operationId_key" ON "RoomEvent"("roomId", "operationId");
CREATE INDEX "RoomEvent_roomId_createdAt_idx" ON "RoomEvent"("roomId", "createdAt");
CREATE INDEX "RoomEvent_roomId_eventType_idx" ON "RoomEvent"("roomId", "eventType");

ALTER TABLE "RoomEvent"
ADD CONSTRAINT "RoomEvent_roomId_fkey"
FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RoomEvent"
ADD CONSTRAINT "RoomEvent_actorSessionId_fkey"
FOREIGN KEY ("actorSessionId") REFERENCES "GuestSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;