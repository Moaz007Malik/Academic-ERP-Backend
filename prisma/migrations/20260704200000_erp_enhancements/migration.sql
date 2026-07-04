-- Student profile fields
ALTER TABLE "Student" ADD COLUMN IF NOT EXISTS "registrationNumber" VARCHAR(50);
ALTER TABLE "Student" ADD COLUMN IF NOT EXISTS "admissionNumber" VARCHAR(50);
ALTER TABLE "Student" ADD COLUMN IF NOT EXISTS "bloodGroup" VARCHAR(10);
ALTER TABLE "Student" ADD COLUMN IF NOT EXISTS "fatherName" VARCHAR(200);
ALTER TABLE "Student" ADD COLUMN IF NOT EXISTS "motherName" VARCHAR(200);
ALTER TABLE "Student" ADD COLUMN IF NOT EXISTS "guardianRelation" VARCHAR(50);
ALTER TABLE "Student" ADD COLUMN IF NOT EXISTS "guardianEmail" VARCHAR(200);
ALTER TABLE "Student" ADD COLUMN IF NOT EXISTS "notes" TEXT;

-- Teacher profile fields
ALTER TABLE "Teacher" ADD COLUMN IF NOT EXISTS "departmentId" TEXT;
ALTER TABLE "Teacher" ADD COLUMN IF NOT EXISTS "designation" VARCHAR(100);
ALTER TABLE "Teacher" ADD COLUMN IF NOT EXISTS "employmentType" VARCHAR(50);
ALTER TABLE "Teacher" ADD COLUMN IF NOT EXISTS "experienceYears" INTEGER;
ALTER TABLE "Teacher" ADD COLUMN IF NOT EXISTS "phone" VARCHAR(20);
ALTER TABLE "Teacher" ADD COLUMN IF NOT EXISTS "photo" VARCHAR(500);
ALTER TABLE "Teacher" ADD COLUMN IF NOT EXISTS "paymentMethod" VARCHAR(50);
ALTER TABLE "Teacher" ADD COLUMN IF NOT EXISTS "allowances" DECIMAL(10,2);
ALTER TABLE "Teacher" ADD COLUMN IF NOT EXISTS "deductions" DECIMAL(10,2);
ALTER TABLE "Teacher" ADD COLUMN IF NOT EXISTS "notes" TEXT;

DO $$ BEGIN
  ALTER TABLE "Teacher" ADD CONSTRAINT "Teacher_departmentId_fkey"
    FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Student promotion history
CREATE TABLE IF NOT EXISTS "StudentPromotion" (
    "id" TEXT NOT NULL,
    "instituteId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "fromBatchId" TEXT,
    "toBatchId" TEXT,
    "fromSectionId" TEXT,
    "toSectionId" TEXT,
    "sessionName" VARCHAR(100),
    "promotedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    CONSTRAINT "StudentPromotion_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "StudentPromotion_studentId_idx" ON "StudentPromotion"("studentId");

DO $$ BEGIN
  ALTER TABLE "StudentPromotion" ADD CONSTRAINT "StudentPromotion_studentId_fkey"
    FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Student notes / timeline
CREATE TABLE IF NOT EXISTS "StudentNote" (
    "id" TEXT NOT NULL,
    "instituteId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "authorId" TEXT,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StudentNote_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "StudentNote_studentId_idx" ON "StudentNote"("studentId");

DO $$ BEGIN
  ALTER TABLE "StudentNote" ADD CONSTRAINT "StudentNote_studentId_fkey"
    FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Individual courses (separate from batch system)
DO $$ BEGIN
  CREATE TYPE "IndividualCourseStatus" AS ENUM ('DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "CourseEnrollmentStatus" AS ENUM ('ENROLLED', 'COMPLETED', 'DROPPED', 'SUSPENDED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "IndividualCourse" (
    "id" TEXT NOT NULL,
    "instituteId" TEXT NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "duration" VARCHAR(100),
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "capacity" INTEGER NOT NULL DEFAULT 30,
    "description" TEXT,
    "status" "IndividualCourseStatus" NOT NULL DEFAULT 'ACTIVE',
    "admissionFee" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "monthlyFee" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "oneTimeFee" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "scholarshipAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "IndividualCourse_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "IndividualCourse_instituteId_code_key" ON "IndividualCourse"("instituteId", "code");
CREATE INDEX IF NOT EXISTS "IndividualCourse_instituteId_status_idx" ON "IndividualCourse"("instituteId", "status");

DO $$ BEGIN
  ALTER TABLE "IndividualCourse" ADD CONSTRAINT "IndividualCourse_instituteId_fkey"
    FOREIGN KEY ("instituteId") REFERENCES "Institute"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "IndividualCourseTeacher" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IndividualCourseTeacher_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "IndividualCourseTeacher_courseId_teacherId_key" ON "IndividualCourseTeacher"("courseId", "teacherId");

DO $$ BEGIN
  ALTER TABLE "IndividualCourseTeacher" ADD CONSTRAINT "IndividualCourseTeacher_courseId_fkey"
    FOREIGN KEY ("courseId") REFERENCES "IndividualCourse"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  ALTER TABLE "IndividualCourseTeacher" ADD CONSTRAINT "IndividualCourseTeacher_teacherId_fkey"
    FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "IndividualCourseEnrollment" (
    "id" TEXT NOT NULL,
    "instituteId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "status" "CourseEnrollmentStatus" NOT NULL DEFAULT 'ENROLLED',
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "feePaid" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "feeDue" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    CONSTRAINT "IndividualCourseEnrollment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "IndividualCourseEnrollment_courseId_studentId_key" ON "IndividualCourseEnrollment"("courseId", "studentId");
CREATE INDEX IF NOT EXISTS "IndividualCourseEnrollment_instituteId_idx" ON "IndividualCourseEnrollment"("instituteId");

DO $$ BEGIN
  ALTER TABLE "IndividualCourseEnrollment" ADD CONSTRAINT "IndividualCourseEnrollment_courseId_fkey"
    FOREIGN KEY ("courseId") REFERENCES "IndividualCourse"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  ALTER TABLE "IndividualCourseEnrollment" ADD CONSTRAINT "IndividualCourseEnrollment_studentId_fkey"
    FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Subscription invoice grace tracking
ALTER TABLE "SubscriptionInvoice" ADD COLUMN IF NOT EXISTS "graceEndsAt" TIMESTAMP(3);
