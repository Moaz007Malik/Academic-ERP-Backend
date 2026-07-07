/** Institute → platform requests; auto-forward to Super Admin on create */
export const PLATFORM_TICKET_CATEGORIES = [
  'PASSWORD_RESET',
  'LOGO_UPDATE',
  'STORAGE',
  'FEATURE_REQUEST',
  'CARD_DESIGN',
  'SUBSCRIPTION',
];

/** Student/teacher portal categories — institute handles first */
export const PORTAL_TICKET_CATEGORIES = [
  'ACADEMIC',
  'FEE_FINANCE',
  'ATTENDANCE',
  'TECHNICAL',
  'OTHER',
];

export function shouldAutoEscalateTicket(category, creatorRole) {
  if (creatorRole === 'SUPER_ADMIN') return false;
  if (['STUDENT', 'TEACHER'].includes(creatorRole)) return false;
  return PLATFORM_TICKET_CATEGORIES.includes(category);
}
