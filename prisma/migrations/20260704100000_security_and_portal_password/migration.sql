-- User.portalPassword (admin-visible portal passwords)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "portalPassword" VARCHAR(200);

-- Institute.settings JSON
ALTER TABLE "Institute" ADD COLUMN IF NOT EXISTS "settings" JSONB NOT NULL DEFAULT '{}';

-- Login lockout tracking
CREATE TABLE IF NOT EXISTS "LoginAttempt" (
    "id" TEXT NOT NULL,
    "email" VARCHAR(200) NOT NULL,
    "ipAddress" TEXT,
    "success" BOOLEAN NOT NULL,
    "failReason" VARCHAR(100),
    "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LoginAttempt_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "LoginAttempt_email_attemptedAt_idx" ON "LoginAttempt"("email", "attemptedAt");
CREATE INDEX IF NOT EXISTS "LoginAttempt_ipAddress_attemptedAt_idx" ON "LoginAttempt"("ipAddress", "attemptedAt");

-- User sessions
CREATE TABLE IF NOT EXISTS "UserSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "refreshJti" VARCHAR(100),
    "deviceName" VARCHAR(200),
    "deviceType" VARCHAR(50),
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "isTrusted" BOOLEAN NOT NULL DEFAULT false,
    "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserSession_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "UserSession_userId_revokedAt_idx" ON "UserSession"("userId", "revokedAt");

DO $$ BEGIN
  ALTER TABLE "UserSession" ADD CONSTRAINT "UserSession_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Password history (change-password policy)
CREATE TABLE IF NOT EXISTS "PasswordHistory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "passwordHash" VARCHAR(500) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PasswordHistory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PasswordHistory_userId_createdAt_idx" ON "PasswordHistory"("userId", "createdAt");

DO $$ BEGIN
  ALTER TABLE "PasswordHistory" ADD CONSTRAINT "PasswordHistory_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- IP whitelist (optional institute security)
CREATE TABLE IF NOT EXISTS "IpWhitelist" (
    "id" TEXT NOT NULL,
    "instituteId" TEXT NOT NULL,
    "cidr" VARCHAR(50) NOT NULL,
    "label" VARCHAR(100),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IpWhitelist_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "IpWhitelist_instituteId_isActive_idx" ON "IpWhitelist"("instituteId", "isActive");

DO $$ BEGIN
  ALTER TABLE "IpWhitelist" ADD CONSTRAINT "IpWhitelist_instituteId_fkey"
    FOREIGN KEY ("instituteId") REFERENCES "Institute"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Domain events (login suspicious activity)
DO $$ BEGIN
  CREATE TYPE "DomainEventStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'DEAD_LETTER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "DomainEvent" (
    "id" TEXT NOT NULL,
    "instituteId" TEXT,
    "eventType" VARCHAR(100) NOT NULL,
    "aggregateType" VARCHAR(50) NOT NULL,
    "aggregateId" TEXT,
    "payload" JSONB NOT NULL,
    "status" "DomainEventStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "correlationId" VARCHAR(100),
    "causationId" VARCHAR(100),
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    CONSTRAINT "DomainEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "DomainEvent_status_occurredAt_idx" ON "DomainEvent"("status", "occurredAt");
CREATE INDEX IF NOT EXISTS "DomainEvent_instituteId_eventType_occurredAt_idx" ON "DomainEvent"("instituteId", "eventType", "occurredAt");
CREATE INDEX IF NOT EXISTS "DomainEvent_aggregateType_aggregateId_idx" ON "DomainEvent"("aggregateType", "aggregateId");
