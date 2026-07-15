-- Academic Class structure: Class-level subjects & fees; Subject/Batch linked to Class

CREATE TABLE IF NOT EXISTS "AcademicClass" (
    "id" TEXT NOT NULL,
    "instituteId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "code" VARCHAR(20),
    "registrationFee" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "monthlyFee" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AcademicClass_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AcademicClass_instituteId_departmentId_name_key"
  ON "AcademicClass"("instituteId", "departmentId", "name");
CREATE INDEX IF NOT EXISTS "AcademicClass_instituteId_idx" ON "AcademicClass"("instituteId");

ALTER TABLE "AcademicClass"
  ADD CONSTRAINT "AcademicClass_instituteId_fkey"
  FOREIGN KEY ("instituteId") REFERENCES "Institute"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AcademicClass"
  ADD CONSTRAINT "AcademicClass_departmentId_fkey"
  FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Subject: allow Class link; make Course optional
ALTER TABLE "Subject" ADD COLUMN IF NOT EXISTS "classId" TEXT;

ALTER TABLE "Subject" ALTER COLUMN "courseId" DROP NOT NULL;

CREATE INDEX IF NOT EXISTS "Subject_classId_idx" ON "Subject"("classId");

ALTER TABLE "Subject"
  DROP CONSTRAINT IF EXISTS "Subject_courseId_fkey";

ALTER TABLE "Subject"
  ADD CONSTRAINT "Subject_courseId_fkey"
  FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Subject"
  ADD CONSTRAINT "Subject_classId_fkey"
  FOREIGN KEY ("classId") REFERENCES "AcademicClass"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Batch → AcademicClass
ALTER TABLE "Batch" ADD COLUMN IF NOT EXISTS "classId" TEXT;
CREATE INDEX IF NOT EXISTS "Batch_classId_idx" ON "Batch"("classId");
ALTER TABLE "Batch"
  ADD CONSTRAINT "Batch_classId_fkey"
  FOREIGN KEY ("classId") REFERENCES "AcademicClass"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Student fee snapshots from Class at admission
ALTER TABLE "Student" ADD COLUMN IF NOT EXISTS "assignedRegistrationFee" DECIMAL(10,2);
ALTER TABLE "Student" ADD COLUMN IF NOT EXISTS "assignedMonthlyFee" DECIMAL(10,2);
ALTER TABLE "Student" ADD COLUMN IF NOT EXISTS "registrationDiscount" DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE "Student" ADD COLUMN IF NOT EXISTS "monthlyDiscount" DECIMAL(10,2) NOT NULL DEFAULT 0;
