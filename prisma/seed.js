import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { CORE_MODULES } from '../src/utils/constants.js';

const prisma = new PrismaClient();

async function upsertPlan(plan) {
  const existing = await prisma.subscriptionPlan.findFirst({ where: { name: plan.name } });
  if (!existing) return prisma.subscriptionPlan.create({ data: plan });
  return existing;
}

async function main() {
  console.log('Seeding database...');

  const plans = [
    {
      name: 'Basic',
      billingCycle: 'MONTHLY',
      price: 5000,
      storageQuotaMB: 5120,
      maxUsers: 500,
      allowedModules: CORE_MODULES,
    },
    {
      name: 'Premium',
      billingCycle: 'QUARTERLY',
      price: 12000,
      storageQuotaMB: 20480,
      maxUsers: 5000,
      allowedModules: [
        ...CORE_MODULES,
        'TIMETABLE', 'LIBRARY', 'PARENT_PORTAL', 'STUDENT_PORTAL',
        'ASSIGNMENTS_QUIZ', 'ADMISSION', 'CERTIFICATES',
      ],
    },
    {
      name: 'Enterprise',
      billingCycle: 'YEARLY',
      price: 50000,
      storageQuotaMB: 102400,
      maxUsers: 999999,
      allowedModules: [
        ...CORE_MODULES,
        'TIMETABLE', 'LIBRARY', 'HOSTEL', 'TRANSPORT', 'HR_PAYROLL',
        'PARENT_PORTAL', 'STUDENT_PORTAL', 'LMS', 'ASSIGNMENTS_QUIZ',
        'ADMISSION', 'INVENTORY', 'CERTIFICATES', 'ONLINE_CLASSES',
      ],
    },
  ];

  const [basicPlan, premiumPlan, enterprisePlan] = await Promise.all(
    plans.map((p) => upsertPlan(p))
  );

  const superAdminEmail = process.env.SUPER_ADMIN_EMAIL || 'admin@erp.local';
  const superAdminPassword = process.env.SUPER_ADMIN_PASSWORD || 'ChangeMe@123';
  const passwordHash = await bcrypt.hash(superAdminPassword, 12);

  const superAdmin = await prisma.user.upsert({
    where: { email: superAdminEmail },
    update: { passwordHash },
    create: {
      email: superAdminEmail,
      passwordHash,
      firstName: 'Super',
      lastName: 'Admin',
      role: 'SUPER_ADMIN',
      instituteId: null,
    },
  });
  console.log(`Super Admin ready: ${superAdminEmail}`);

  const now = new Date();
  const addDays = (d) => { const x = new Date(now); x.setDate(x.getDate() + d); return x; };

  const institutesData = [
    {
      instituteCode: 'GCU-LHR',
      name: 'Greenfield College University',
      status: 'ACTIVE',
      planId: premiumPlan.id,
      expiryDate: addDays(180),
      activeModules: premiumPlan.allowedModules,
      adminEmail: 'admin@greenfield.edu.pk',
      adminName: { firstName: 'Ahmed', lastName: 'Khan' },
    },
    {
      instituteCode: 'SIA-ISB',
      name: 'Sunrise International Academy',
      status: 'ACTIVE',
      planId: basicPlan.id,
      expiryDate: addDays(5),
      activeModules: basicPlan.allowedModules,
      adminEmail: 'admin@sunrise.edu.pk',
      adminName: { firstName: 'Sara', lastName: 'Malik' },
    },
    {
      instituteCode: 'MET-KHI',
      name: 'Metropolitan Engineering College',
      status: 'EXPIRED',
      planId: basicPlan.id,
      expiryDate: addDays(-30),
      activeModules: basicPlan.allowedModules,
      adminEmail: 'admin@metro.edu.pk',
      adminName: { firstName: 'Usman', lastName: 'Ali' },
    },
    {
      instituteCode: 'VHS-RWP',
      name: 'Valley High School',
      status: 'SUSPENDED',
      planId: basicPlan.id,
      expiryDate: addDays(60),
      activeModules: basicPlan.allowedModules,
      adminEmail: 'admin@valley.edu.pk',
      adminName: { firstName: 'Fatima', lastName: 'Hussain' },
    },
    {
      instituteCode: 'TIT-FSD',
      name: 'Tech Institute of Faisalabad',
      status: 'ACTIVE',
      planId: enterprisePlan.id,
      expiryDate: addDays(365),
      activeModules: enterprisePlan.allowedModules,
      adminEmail: 'admin@tit.edu.pk',
      adminName: { firstName: 'Bilal', lastName: 'Ahmed' },
    },
  ];

  for (const inst of institutesData) {
    const existing = await prisma.institute.findUnique({
      where: { instituteCode: inst.instituteCode },
    });
    if (existing) continue;

    const adminPass = await bcrypt.hash('Institute@123', 12);

    const institute = await prisma.institute.create({
      data: {
        instituteCode: inst.instituteCode,
        name: inst.name,
        status: inst.status,
        planId: inst.planId,
        expiryDate: inst.expiryDate,
        activeModules: inst.activeModules,
        storageQuotaMB: 10240,
        storageUsedMB: Math.floor(Math.random() * 3000),
        email: inst.adminEmail,
        phone: '+92-300-0000000',
        address: 'Pakistan',
      },
    });

    await prisma.user.create({
      data: {
        email: inst.adminEmail,
        passwordHash: adminPass,
        firstName: inst.adminName.firstName,
        lastName: inst.adminName.lastName,
        role: 'INSTITUTE_ADMIN',
        instituteId: institute.id,
        mustChangePass: true,
      },
    });

    if (inst.status === 'ACTIVE') {
      const students = [
        { firstName: 'Ali', lastName: 'Raza', rollNumber: '2024-001' },
        { firstName: 'Ayesha', lastName: 'Noor', rollNumber: '2024-002' },
        { firstName: 'Hassan', lastName: 'Sheikh', rollNumber: '2024-003' },
      ];
      for (const s of students) {
        await prisma.student.create({
          data: {
            instituteId: institute.id,
            firstName: s.firstName,
            lastName: s.lastName,
            rollNumber: s.rollNumber,
            status: 'ACTIVE',
            enrollmentDate: now,
          },
        });
      }

      await prisma.teacher.create({
        data: {
          instituteId: institute.id,
          employeeCode: 'T-001',
          firstName: 'Dr. Imran',
          lastName: 'Qureshi',
          qualification: 'PhD',
          status: 'ACTIVE',
          joiningDate: addDays(-400),
        },
      });
    }

    await prisma.subscriptionInvoice.create({
      data: {
        invoiceNumber: `INV-${inst.instituteCode}-${Date.now()}`,
        instituteId: institute.id,
        planId: inst.planId,
        type: 'INITIAL',
        amount: inst.planId === enterprisePlan.id ? 50000 : inst.planId === premiumPlan.id ? 12000 : 5000,
        status: inst.status === 'EXPIRED' ? 'PENDING' : 'PAID',
        dueDate: addDays(14),
        paidAt: inst.status !== 'EXPIRED' ? now : null,
        periodFrom: addDays(-30),
        periodTo: inst.expiryDate,
        createdById: superAdmin.id,
      },
    });

    console.log(`  Institute created: ${inst.instituteCode} (${inst.status})`);
  }

  const greenfield = await prisma.institute.findUnique({ where: { instituteCode: 'GCU-LHR' } });
  const metro = await prisma.institute.findUnique({ where: { instituteCode: 'MET-KHI' } });

  if (greenfield) {
    const gcuAdmin = await prisma.user.findUnique({ where: { email: 'admin@greenfield.edu.pk' } });
    const existingTicket = await prisma.supportTicket.findFirst({
      where: { instituteId: greenfield.id, subject: 'Request logo update' },
    });
    if (!existingTicket && gcuAdmin) {
      await prisma.supportTicket.create({
        data: {
          instituteId: greenfield.id,
          createdById: gcuAdmin.id,
          subject: 'Request logo update',
          category: 'LOGO_UPDATE',
          description: 'Please update our institute logo on the portal.',
          status: 'OPEN',
          priority: 'MEDIUM',
        },
      });
    }
  }

  if (metro) {
    const metroAdmin = await prisma.user.findUnique({ where: { email: 'admin@metro.edu.pk' } });
    const existingTicket = await prisma.supportTicket.findFirst({
      where: { instituteId: metro.id, subject: 'Subscription renewal request' },
    });
    if (!existingTicket && metroAdmin) {
      await prisma.supportTicket.create({
        data: {
          instituteId: metro.id,
          createdById: metroAdmin.id,
          subject: 'Subscription renewal request',
          category: 'SUBSCRIPTION',
          description: 'Our subscription expired. We have made the bank transfer.',
          status: 'OPEN',
          priority: 'HIGH',
        },
      });
    }
  }

  console.log('Seed completed with dummy institutes, students, teachers, invoices & tickets.');
  console.log('Institute admin password (all): Institute@123');

  await seedGreenfieldAcademic(now, addDays);
}

async function seedGreenfieldAcademic(now, addDays) {
  const institute = await prisma.institute.findUnique({ where: { instituteCode: 'GCU-LHR' } });
  if (!institute) return;

  const existingSession = await prisma.session.findFirst({ where: { instituteId: institute.id } });
  if (existingSession) {
    console.log('  GCU-LHR academic data exists — syncing portal users...');
    const studentPass = await bcrypt.hash('Student@123', 12);
    const studentData = [
      { firstName: 'Ali', lastName: 'Raza', rollNumber: '2024-001', email: 'ali.raza@greenfield.edu.pk' },
      { firstName: 'Ayesha', lastName: 'Noor', rollNumber: '2024-002', email: 'ayesha.noor@greenfield.edu.pk' },
      { firstName: 'Hassan', lastName: 'Sheikh', rollNumber: '2024-003', email: 'hassan.sheikh@greenfield.edu.pk' },
    ];
    for (const s of studentData) {
      const student = await prisma.student.findFirst({ where: { instituteId: institute.id, rollNumber: s.rollNumber } });
      if (!student) continue;
      const user = await prisma.user.upsert({
        where: { email: s.email },
        update: { passwordHash: studentPass },
        create: {
          email: s.email, passwordHash: studentPass, firstName: s.firstName, lastName: s.lastName,
          role: 'STUDENT', instituteId: institute.id,
        },
      });
      await prisma.student.update({ where: { id: student.id }, data: { userId: user.id } });
    }
    const teacherPass = await bcrypt.hash('Teacher@123', 12);
    await prisma.user.upsert({
      where: { email: 'imran.qureshi@greenfield.edu.pk' },
      update: { passwordHash: teacherPass },
      create: {
        email: 'imran.qureshi@greenfield.edu.pk', passwordHash: teacherPass,
        firstName: 'Dr. Imran', lastName: 'Qureshi', role: 'TEACHER', instituteId: institute.id,
      },
    });
    const teacherUser = await prisma.user.findUnique({ where: { email: 'imran.qureshi@greenfield.edu.pk' } });
    const teacher = await prisma.teacher.findFirst({ where: { instituteId: institute.id, employeeCode: 'T-001' } });
    if (teacher && teacherUser) {
      await prisma.teacher.update({ where: { id: teacher.id }, data: { userId: teacherUser.id } });
    }
    console.log('  Portal users synced for GCU-LHR');
    return;
  }

  console.log('  Seeding GCU-LHR academic structure, portal users, exams & results...');

  const session = await prisma.session.create({
    data: {
      instituteId: institute.id,
      name: '2024-2025',
      startDate: addDays(-180),
      endDate: addDays(180),
      isActive: true,
    },
  });

  const semester = await prisma.semester.create({
    data: {
      instituteId: institute.id,
      sessionId: session.id,
      name: '1st Semester',
      number: 1,
      startDate: addDays(-180),
      endDate: addDays(30),
    },
  });

  const dept = await prisma.department.create({
    data: { instituteId: institute.id, name: 'Science', code: 'SCI' },
  });

  const course = await prisma.course.create({
    data: { instituteId: institute.id, departmentId: dept.id, name: 'Matric Science', code: 'MAT-SCI', creditHours: 3 },
  });

  const subjects = await Promise.all([
    prisma.subject.create({ data: { instituteId: institute.id, courseId: course.id, name: 'Mathematics', code: 'MATH', creditHours: 3 } }),
    prisma.subject.create({ data: { instituteId: institute.id, courseId: course.id, name: 'Physics', code: 'PHY', creditHours: 3 } }),
    prisma.subject.create({ data: { instituteId: institute.id, courseId: course.id, name: 'English', code: 'ENG', creditHours: 3 } }),
  ]);

  const batch = await prisma.batch.create({
    data: { instituteId: institute.id, sessionId: session.id, name: 'Class 10', year: 10 },
  });

  const section = await prisma.section.create({
    data: { instituteId: institute.id, batchId: batch.id, name: 'A', capacity: 40 },
  });

  const teacherPass = await bcrypt.hash('Teacher@123', 12);
  const studentPass = await bcrypt.hash('Student@123', 12);

  const teacherUser = await prisma.user.create({
    data: {
      email: 'imran.qureshi@greenfield.edu.pk',
      passwordHash: teacherPass,
      firstName: 'Dr. Imran',
      lastName: 'Qureshi',
      role: 'TEACHER',
      instituteId: institute.id,
    },
  });

  let teacher = await prisma.teacher.findFirst({ where: { instituteId: institute.id, employeeCode: 'T-001' } });
  if (teacher) {
    teacher = await prisma.teacher.update({ where: { id: teacher.id }, data: { userId: teacherUser.id } });
  } else {
    teacher = await prisma.teacher.create({
      data: {
        instituteId: institute.id,
        userId: teacherUser.id,
        employeeCode: 'T-001',
        firstName: 'Dr. Imran',
        lastName: 'Qureshi',
        qualification: 'PhD Mathematics',
        specialization: 'Mathematics',
        status: 'ACTIVE',
        joiningDate: addDays(-400),
      },
    });
  }

  await prisma.teacherAssignment.createMany({
    data: [
      { instituteId: institute.id, teacherId: teacher.id, subjectId: subjects[0].id, sectionId: section.id },
      { instituteId: institute.id, teacherId: teacher.id, subjectId: subjects[1].id, sectionId: section.id },
    ],
  });

  const studentData = [
    { firstName: 'Ali', lastName: 'Raza', rollNumber: '2024-001', email: 'ali.raza@greenfield.edu.pk' },
    { firstName: 'Ayesha', lastName: 'Noor', rollNumber: '2024-002', email: 'ayesha.noor@greenfield.edu.pk' },
    { firstName: 'Hassan', lastName: 'Sheikh', rollNumber: '2024-003', email: 'hassan.sheikh@greenfield.edu.pk' },
  ];

  const students = [];
  for (const s of studentData) {
    let student = await prisma.student.findFirst({ where: { instituteId: institute.id, rollNumber: s.rollNumber } });
    const user = await prisma.user.upsert({
      where: { email: s.email },
      update: { passwordHash: studentPass },
      create: {
        email: s.email,
        passwordHash: studentPass,
        firstName: s.firstName,
        lastName: s.lastName,
        role: 'STUDENT',
        instituteId: institute.id,
      },
    });
    if (!student) {
      student = await prisma.student.create({
        data: {
          instituteId: institute.id,
          userId: user.id,
          firstName: s.firstName,
          lastName: s.lastName,
          rollNumber: s.rollNumber,
          status: 'ACTIVE',
          currentBatchId: batch.id,
          currentSectionId: section.id,
          enrollmentDate: now,
        },
      });
    } else {
      student = await prisma.student.update({
        where: { id: student.id },
        data: { userId: user.id, currentBatchId: batch.id, currentSectionId: section.id },
      });
    }
    students.push(student);
  }

  const feeStructure = await prisma.feeStructure.create({
    data: { instituteId: institute.id, name: 'Monthly Tuition', amount: 5000, frequency: 'MONTHLY' },
  });

  for (const student of students) {
    await prisma.fee.create({
      data: {
        instituteId: institute.id,
        studentId: student.id,
        feeStructureId: feeStructure.id,
        amount: 5000,
        dueDate: addDays(15),
        status: student.rollNumber === '2024-001' ? 'PAID' : 'PENDING',
        paidDate: student.rollNumber === '2024-001' ? now : null,
      },
    });
  }

  const exam = await prisma.exam.create({
    data: {
      instituteId: institute.id,
      name: 'Final Term 2024',
      examType: 'FINAL',
      sectionId: section.id,
      semesterId: semester.id,
      startDate: addDays(-14),
      endDate: addDays(-7),
      theoryMax: 75,
      practicalMax: 15,
      internalMax: 10,
      passPercentage: 33,
      isPublished: true,
    },
  });

  const marksData = [
    { studentIdx: 0, subjectIdx: 0, theory: 62, practical: 12, internal: 8 },
    { studentIdx: 0, subjectIdx: 1, theory: 55, practical: 13, internal: 9 },
    { studentIdx: 1, subjectIdx: 0, theory: 70, practical: 14, internal: 9 },
    { studentIdx: 1, subjectIdx: 1, theory: 68, practical: 13, internal: 8 },
    { studentIdx: 2, subjectIdx: 0, theory: 45, practical: 10, internal: 7 },
    { studentIdx: 2, subjectIdx: 1, theory: 38, practical: 8, internal: 6 },
  ];

  for (const m of marksData) {
    const total = m.theory + m.practical + m.internal;
    const pct = total;
    const grade = pct >= 80 ? 'A+' : pct >= 70 ? 'A' : pct >= 60 ? 'B' : pct >= 50 ? 'C' : pct >= 40 ? 'D' : pct >= 33 ? 'E' : 'F';
    const isPassed = total >= 33;
    await prisma.result.create({
      data: {
        instituteId: institute.id,
        studentId: students[m.studentIdx].id,
        subjectId: subjects[m.subjectIdx].id,
        examId: exam.id,
        theoryMarks: m.theory,
        practicalMarks: m.practical,
        internalMarks: m.internal,
        totalMarks: total,
        maxMarks: 100,
        grade: isPassed ? grade : 'F',
        gradePoints: isPassed ? (grade === 'A+' ? 4 : grade === 'A' ? 3.7 : 3) : 0,
        isPassed,
        publishedAt: now,
      },
    });
  }

  for (let i = 0; i < 5; i++) {
    for (const student of students) {
      for (const subject of subjects.slice(0, 2)) {
        await prisma.attendance.create({
          data: {
            instituteId: institute.id,
            studentId: student.id,
            subjectId: subject.id,
            date: addDays(-i * 7),
            status: i === 2 && student.rollNumber === '2024-003' ? 'ABSENT' : 'PRESENT',
          },
        });
      }
    }
  }

  await prisma.timetable.createMany({
    data: [
      { instituteId: institute.id, subjectId: subjects[0].id, sectionId: section.id, teacherId: teacher.id, dayOfWeek: 1, startTime: '08:00', endTime: '09:00', room: '101' },
      { instituteId: institute.id, subjectId: subjects[1].id, sectionId: section.id, teacherId: teacher.id, dayOfWeek: 2, startTime: '09:00', endTime: '10:00', room: 'Lab-1' },
      { instituteId: institute.id, subjectId: subjects[2].id, sectionId: section.id, teacherId: teacher.id, dayOfWeek: 3, startTime: '10:00', endTime: '11:00', room: '102' },
    ],
  });

  console.log('  GCU-LHR seeded: Teacher imran.qureshi@greenfield.edu.pk / Teacher@123');
  console.log('  GCU-LHR seeded: Students ali.raza@... / Student@123');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
