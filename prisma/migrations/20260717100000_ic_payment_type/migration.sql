-- Add payment type for Individual Courses (MONTHLY vs ONE_TIME)
CREATE TYPE "IndividualCoursePaymentType" AS ENUM ('MONTHLY', 'ONE_TIME');

ALTER TABLE "IndividualCourse"
  ADD COLUMN IF NOT EXISTS "paymentType" "IndividualCoursePaymentType" NOT NULL DEFAULT 'ONE_TIME';

-- Backfill: courses with monthlyFee > 0 and no meaningful one-time fees → MONTHLY
UPDATE "IndividualCourse"
SET "paymentType" = 'MONTHLY'
WHERE "monthlyFee" > 0 AND ("oneTimeFee" IS NULL OR "oneTimeFee" = 0);
