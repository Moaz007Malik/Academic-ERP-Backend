/**
 * Pakistani education grading (Matric/Intermediate/University style)
 * Theory + Practical + Internal = Total (typically 75+15+10 or 100)
 */

export const PAKISTANI_GRADE_SCALE = [
  { min: 80, grade: 'A+', points: 4.0, division: '1st' },
  { min: 70, grade: 'A', points: 3.7, division: '1st' },
  { min: 60, grade: 'B', points: 3.3, division: '1st' },
  { min: 50, grade: 'C', points: 3.0, division: '2nd' },
  { min: 40, grade: 'D', points: 2.0, division: '2nd' },
  { min: 33, grade: 'E', points: 1.0, division: '3rd' },
  { min: 0, grade: 'F', points: 0.0, division: 'Fail' },
];

export function calculateMarks(theory, practical, internal) {
  const t = Number(theory) || 0;
  const p = Number(practical) || 0;
  const i = Number(internal) || 0;
  return Math.round((t + p + i) * 100) / 100;
}

export function getGradeFromMarks(obtained, maxMarks = 100, passPercentage = 33) {
  const percentage = maxMarks > 0 ? (obtained / maxMarks) * 100 : 0;
  const passMarks = (maxMarks * passPercentage) / 100;
  const isPassed = obtained >= passMarks;

  let gradeInfo = PAKISTANI_GRADE_SCALE[PAKISTANI_GRADE_SCALE.length - 1];
  for (const g of PAKISTANI_GRADE_SCALE) {
    if (percentage >= g.min) {
      gradeInfo = g;
      break;
    }
  }

  return {
    totalMarks: obtained,
    percentage: Math.round(percentage * 100) / 100,
    grade: isPassed ? gradeInfo.grade : 'F',
    gradePoints: isPassed ? gradeInfo.points : 0,
    division: isPassed ? gradeInfo.division : 'Fail',
    isPassed,
  };
}

export function computeResult({ theoryMarks, practicalMarks, internalMarks, theoryMax = 75, practicalMax = 15, internalMax = 10, passPercentage = 33 }) {
  const total = calculateMarks(theoryMarks, practicalMarks, internalMarks);
  const maxMarks = theoryMax + practicalMax + internalMax;
  const grades = getGradeFromMarks(total, maxMarks, passPercentage);
  return { ...grades, maxMarks, theoryMarks: Number(theoryMarks) || 0, practicalMarks: Number(practicalMarks) || 0, internalMarks: Number(internalMarks) || 0 };
}

export function calculateCGPA(results) {
  if (!results?.length) return { cgpa: 0, totalCredits: 0 };
  let totalPoints = 0;
  let count = 0;
  for (const r of results) {
    if (r.gradePoints != null && r.isPassed !== false) {
      totalPoints += Number(r.gradePoints);
      count++;
    }
  }
  return { cgpa: count ? Math.round((totalPoints / count) * 100) / 100 : 0, subjectsCount: count };
}
