import Joi from 'joi';
import { validatePasswordStrength } from '../../utils/passwordPolicy.js';

const newPasswordRule = Joi.string()
  .required()
  .custom((value, helpers) => {
    const err = validatePasswordStrength(value);
    if (err) return helpers.error('any.custom', { message: err });
    return value;
  }, 'password strength');

export const loginSchema = Joi.object({
  email: Joi.string().email({ tlds: { allow: false } }).required(),
  password: Joi.string().min(6).required(),
});

export const forgotPasswordSchema = Joi.object({
  email: Joi.string().email({ tlds: { allow: false } }).required(),
});

export const resetPasswordSchema = Joi.object({
  email: Joi.string().email({ tlds: { allow: false } }).required(),
  otp: Joi.string().length(6).required(),
  newPassword: newPasswordRule,
});

export const changePasswordSchema = Joi.object({
  currentPassword: Joi.string().required(),
  newPassword: newPasswordRule,
});

export function validate(schema) {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, { abortEarly: false });
    if (error) {
      const details = error.details.map((d) => d.context?.message || d.message);
      return res.status(400).json({
        success: false,
        message: details[0] || 'Validation failed',
        details,
      });
    }
    req.body = value;
    next();
  };
}
