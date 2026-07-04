/** Shared password strength rules — keep in sync with frontend/src/utils/passwordPolicy.js */

export const PASSWORD_POLICY = {
  minLength: 8,
  minUppercase: 1,
  minLowercase: 1,
  minDigits: 1,
  historyCount: 5,
};

export function getPasswordPolicyDescription() {
  const { minLength, minUppercase, minLowercase, minDigits } = PASSWORD_POLICY;
  return {
    minLength,
    minUppercase,
    minLowercase,
    minDigits,
    summary: `At least ${minLength} characters, including ${minUppercase} uppercase letter, ${minLowercase} lowercase letter, and ${minDigits} digit.`,
  };
}

export function checkPasswordStrength(password) {
  const p = password || '';
  const uppercase = (p.match(/[A-Z]/g) || []).length;
  const lowercase = (p.match(/[a-z]/g) || []).length;
  const digits = (p.match(/[0-9]/g) || []).length;

  const rules = {
    minLength: p.length >= PASSWORD_POLICY.minLength,
    uppercase: uppercase >= PASSWORD_POLICY.minUppercase,
    lowercase: lowercase >= PASSWORD_POLICY.minLowercase,
    digits: digits >= PASSWORD_POLICY.minDigits,
  };

  return {
    ...rules,
    valid: rules.minLength && rules.uppercase && rules.lowercase && rules.digits,
    counts: { uppercase, lowercase, digits, length: p.length },
  };
}

export function validatePasswordStrength(password) {
  const result = checkPasswordStrength(password);
  if (result.valid) return null;

  const errors = [];
  if (!result.minLength) {
    errors.push(`Password must be at least ${PASSWORD_POLICY.minLength} characters`);
  }
  if (!result.uppercase) {
    errors.push(`Include at least ${PASSWORD_POLICY.minUppercase} uppercase letter (A–Z)`);
  }
  if (!result.lowercase) {
    errors.push(`Include at least ${PASSWORD_POLICY.minLowercase} lowercase letter (a–z)`);
  }
  if (!result.digits) {
    errors.push(`Include at least ${PASSWORD_POLICY.minDigits} digit (0–9)`);
  }
  return errors.join('. ');
}
