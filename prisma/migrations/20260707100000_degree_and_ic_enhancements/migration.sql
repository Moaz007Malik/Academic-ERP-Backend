-- Individual Course attendance
CREATE TABLE "IndividualCourseAttendance" (
    "id" TEXT NOT NULL,
    "instituteId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "lectureNumber" INTEGER NOT NULL DEFAULT 1,
    "status" "AttendanceStatus" NOT NULL,
    "markedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IndividualCourseAttendance_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IndividualCourseAttendance_instituteId_courseId_studentId_date_lectureNumber_key" ON "IndividualCourseAttendance"("instituteId", "courseId", "studentId", "date", "lectureNumber");
CREATE INDEX "IndividualCourseAttendance_instituteId_courseId_date_idx" ON "IndividualCourseAttendance"("instituteId", "courseId", "date");

ALTER TABLE "IndividualCourseAttendance" ADD CONSTRAINT "IndividualCourseAttendance_instituteId_fkey" FOREIGN KEY ("instituteId") REFERENCES "Institute"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "IndividualCourseAttendance" ADD CONSTRAINT "IndividualCourseAttendance_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "IndividualCourse"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IndividualCourseAttendance" ADD CONSTRAINT "IndividualCourseAttendance_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IndividualCourseAttendance" ADD CONSTRAINT "IndividualCourseAttendance_markedById_fkey" FOREIGN KEY ("markedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Fee links
ALTER TABLE "Fee" ADD COLUMN "individualCourseEnrollmentId" TEXT;
ALTER TABLE "Fee" ADD COLUMN "degreeStudentId" TEXT;
CREATE INDEX "Fee_individualCourseEnrollmentId_idx" ON "Fee"("individualCourseEnrollmentId");
CREATE INDEX "Fee_degreeStudentId_idx" ON "Fee"("degreeStudentId");
ALTER TABLE "Fee" ADD CONSTRAINT "Fee_individualCourseEnrollmentId_fkey" FOREIGN KEY ("individualCourseEnrollmentId") REFERENCES "IndividualCourseEnrollment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Degree enums
CREATE TYPE "DegreeProgramStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');
CREATE TYPE "DegreeBatchStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'ARCHIVED');
CREATE TYPE "DegreeStudentStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'DROPOUT', 'SUSPENDED', 'GRADUATED', 'COMPLETED', 'LEFT', 'EXPELLED');

-- Degree tables
CREATE TABLE "Degree" (
    "id" TEXT NOT NULL,
    "instituteId" TEXT NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "description" TEXT,
    "status" "DegreeProgramStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Degree_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Degree_instituteId_code_key" ON "Degree"("instituteId", "code");
CREATE INDEX "Degree_instituteId_status_idx" ON "Degree"("instituteId", "status");
ALTER TABLE "Degree" ADD CONSTRAINT "Degree_instituteId_fkey" FOREIGN KEY ("instituteId") REFERENCES "Institute"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "DegreeBatch" (
    "id" TEXT NOT NULL,
    "instituteId" TEXT NOT NULL,
    "degreeId" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "maxStudents" INTEGER NOT NULL DEFAULT 50,
    "totalSemesters" INTEGER NOT NULL DEFAULT 8,
    "registrationFee" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "currentSemester" INTEGER NOT NULL DEFAULT 1,
    "status" "DegreeBatchStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DegreeBatch_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DegreeBatch_instituteId_degreeId_idx" ON "DegreeBatch"("instituteId", "degreeId");
ALTER TABLE "DegreeBatch" ADD CONSTRAINT "DegreeBatch_instituteId_fkey" FOREIGN KEY ("instituteId") REFERENCES "Institute"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DegreeBatch" ADD CONSTRAINT "DegreeBatch_degreeId_fkey" FOREIGN KEY ("degreeId") REFERENCES "Degree"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "DegreeSemester" (
    "id" TEXT NOT NULL,
    "instituteId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "semesterFee" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "startDate" DATE,
    "endDate" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DegreeSemester_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DegreeSemester_batchId_number_key" ON "DegreeSemester"("batchId", "number");
CREATE INDEX "DegreeSemester_instituteId_idx" ON "DegreeSemester"("instituteId");
ALTER TABLE "DegreeSemester" ADD CONSTRAINT "DegreeSemester_instituteId_fkey" FOREIGN KEY ("instituteId") REFERENCES "Institute"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DegreeSemester" ADD CONSTRAINT "DegreeSemester_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "DegreeBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "DegreeSemesterCourse" (
    "id" TEXT NOT NULL,
    "instituteId" TEXT NOT NULL,
    "semesterId" TEXT NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "creditHours" INTEGER NOT NULL DEFAULT 3,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DegreeSemesterCourse_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DegreeSemesterCourse_semesterId_code_key" ON "DegreeSemesterCourse"("semesterId", "code");
CREATE INDEX "DegreeSemesterCourse_instituteId_idx" ON "DegreeSemesterCourse"("instituteId");
ALTER TABLE "DegreeSemesterCourse" ADD CONSTRAINT "DegreeSemesterCourse_instituteId_fkey" FOREIGN KEY ("instituteId") REFERENCES "Institute"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DegreeSemesterCourse" ADD CONSTRAINT "DegreeSemesterCourse_semesterId_fkey" FOREIGN KEY ("semesterId") REFERENCES "DegreeSemester"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "DegreeCourseTeacher" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DegreeCourseTeacher_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DegreeCourseTeacher_courseId_teacherId_key" ON "DegreeCourseTeacher"("courseId", "teacherId");
ALTER TABLE "DegreeCourseTeacher" ADD CONSTRAINT "DegreeCourseTeacher_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "DegreeSemesterCourse"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DegreeCourseTeacher" ADD CONSTRAINT "DegreeCourseTeacher_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "DegreeStudent" (
    "id" TEXT NOT NULL,
    "instituteId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "currentSemesterNumber" INTEGER NOT NULL DEFAULT 1,
    "registrationFee" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "semesterFee" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "discount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "netSemesterFee" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "status" "DegreeStudentStatus" NOT NULL DEFAULT 'ACTIVE',
    "admittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DegreeStudent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DegreeStudent_batchId_studentId_key" ON "DegreeStudent"("batchId", "studentId");
CREATE INDEX "DegreeStudent_instituteId_status_idx" ON "DegreeStudent"("instituteId", "status");
ALTER TABLE "DegreeStudent" ADD CONSTRAINT "DegreeStudent_instituteId_fkey" FOREIGN KEY ("instituteId") REFERENCES "Institute"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DegreeStudent" ADD CONSTRAINT "DegreeStudent_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "DegreeBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DegreeStudent" ADD CONSTRAINT "DegreeStudent_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Fee" ADD CONSTRAINT "Fee_degreeStudentId_fkey" FOREIGN KEY ("degreeStudentId") REFERENCES "DegreeStudent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "DegreeAttendance" (
    "id" TEXT NOT NULL,
    "instituteId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "degreeStudentId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "lectureNumber" INTEGER NOT NULL DEFAULT 1,
    "status" "AttendanceStatus" NOT NULL,
    "markedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DegreeAttendance_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DegreeAttendance_instituteId_courseId_studentId_date_lectureNumber_key" ON "DegreeAttendance"("instituteId", "courseId", "studentId", "date", "lectureNumber");
CREATE INDEX "DegreeAttendance_instituteId_courseId_date_idx" ON "DegreeAttendance"("instituteId", "courseId", "date");
ALTER TABLE "DegreeAttendance" ADD CONSTRAINT "DegreeAttendance_instituteId_fkey" FOREIGN KEY ("instituteId") REFERENCES "Institute"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DegreeAttendance" ADD CONSTRAINT "DegreeAttendance_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "DegreeSemesterCourse"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DegreeAttendance" ADD CONSTRAINT "DegreeAttendance_degreeStudentId_fkey" FOREIGN KEY ("degreeStudentId") REFERENCES "DegreeStudent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DegreeAttendance" ADD CONSTRAINT "DegreeAttendance_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DegreeAttendance" ADD CONSTRAINT "DegreeAttendance_markedById_fkey" FOREIGN KEY ("markedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "DegreeResult" (
    "id" TEXT NOT NULL,
    "instituteId" TEXT NOT NULL,
    "degreeStudentId" TEXT NOT NULL,
    "semesterId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "theoryMarks" DECIMAL(6,2),
    "practicalMarks" DECIMAL(6,2),
    "internalMarks" DECIMAL(6,2),
    "totalMarks" DECIMAL(6,2),
    "maxMarks" DECIMAL(6,2),
    "grade" VARCHAR(5),
    "gradePoints" DECIMAL(3,2),
    "isPassed" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DegreeResult_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DegreeResult_degreeStudentId_courseId_semesterId_key" ON "DegreeResult"("degreeStudentId", "courseId", "semesterId");
CREATE INDEX "DegreeResult_instituteId_semesterId_idx" ON "DegreeResult"("instituteId", "semesterId");
ALTER TABLE "DegreeResult" ADD CONSTRAINT "DegreeResult_instituteId_fkey" FOREIGN KEY ("instituteId") REFERENCES "Institute"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DegreeResult" ADD CONSTRAINT "DegreeResult_degreeStudentId_fkey" FOREIGN KEY ("degreeStudentId") REFERENCES "DegreeStudent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DegreeResult" ADD CONSTRAINT "DegreeResult_semesterId_fkey" FOREIGN KEY ("semesterId") REFERENCES "DegreeSemester"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DegreeResult" ADD CONSTRAINT "DegreeResult_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "DegreeSemesterCourse"("id") ON DELETE CASCADE ON UPDATE CASCADE;
