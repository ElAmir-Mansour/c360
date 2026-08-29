import { z } from 'zod';
import {
  createValidationMessageResolver,
  type ValidationMessageResolver,
} from './validation-messages';

const personNameRegex = /^[\p{L}\s'-]+$/u;

function strongPasswordSchema(t: ValidationMessageResolver) {
  return z
    .string()
    .min(12, t('passwordMin'))
    .max(128, t('passwordMax'))
    .regex(/[A-Z]/, t('passwordUppercase'))
    .regex(/[a-z]/, t('passwordLowercase'))
    .regex(/[0-9]/, t('passwordNumber'))
    .regex(/[^a-zA-Z0-9]/, t('passwordSpecial'));
}

export function createLoginSchema(locale?: string | null) {
  const t = createValidationMessageResolver(locale);

  return z.object({
    email: z
      .string()
      .min(1, t('emailRequired'))
      .email(t('emailInvalid')),
    password: z.string().min(1, t('passwordRequired')),
  });
}

export function createRegisterSchema(locale?: string | null) {
  const t = createValidationMessageResolver(locale);

  return z
    .object({
      organization_name: z
        .string()
        .min(2, t('organizationNameRequired'))
        .max(100, t('organizationNameMax')),
      industry: z
        .string()
        .min(1, t('industryRequired')),
      country: z
        .string()
        .length(2, t('countryTwoLetter'))
        .regex(/^[A-Za-z]{2}$/, t('countryInvalid')),
      first_name: z
        .string()
        .min(1, t('firstNameRequired'))
        .max(100, t('firstNameMax'))
        .regex(personNameRegex, t('firstNameInvalid')),
      last_name: z
        .string()
        .min(1, t('lastNameRequired'))
        .max(100, t('lastNameMax'))
        .regex(personNameRegex, t('lastNameInvalid')),
      email: z
        .string()
        .min(1, t('emailRequired'))
        .email(t('emailInvalid')),
      password: strongPasswordSchema(t),
      confirm_password: z.string().min(1, t('confirmPasswordRequired')),
    })
    .refine((data) => data.password === data.confirm_password, {
      message: t('passwordMismatch'),
      path: ['confirm_password'],
    });
}

export function createForgotPasswordSchema(locale?: string | null) {
  const t = createValidationMessageResolver(locale);

  return z.object({
    email: z
      .string()
      .min(1, t('emailRequired'))
      .email(t('emailInvalid')),
  });
}

export function createResetPasswordSchema(locale?: string | null) {
  const t = createValidationMessageResolver(locale);

  return z
    .object({
      password: strongPasswordSchema(t),
      confirm_password: z.string().min(1, t('confirmPasswordRequired')),
    })
    .refine((data) => data.password === data.confirm_password, {
      message: t('passwordMismatch'),
      path: ['confirm_password'],
    });
}

export function createMfaCodeSchema(locale?: string | null) {
  const t = createValidationMessageResolver(locale);

  return z.object({
    code: z
      .string()
      .min(6, t('mfaCodeSixDigits'))
      .max(6, t('mfaCodeSixDigits'))
      .regex(/^\d{6}$/, t('mfaCodeSixDigits')),
  });
}

export function createMfaRecoverySchema(locale?: string | null) {
  const t = createValidationMessageResolver(locale);

  return z.object({
    code: z
      .string()
      .min(1, t('recoveryCodeRequired'))
      .max(20, t('recoveryCodeInvalid')),
  });
}

export function createChangePasswordSchema(locale?: string | null) {
  const t = createValidationMessageResolver(locale);

  return z
    .object({
      current_password: z.string().min(1, t('currentPasswordRequired')),
      new_password: strongPasswordSchema(t),
      confirm_password: z.string().min(1, t('confirmPasswordRequired')),
    })
    .refine((data) => data.new_password === data.confirm_password, {
      message: t('passwordMismatch'),
      path: ['confirm_password'],
    })
    .refine((data) => data.current_password !== data.new_password, {
      message: t('passwordMustChange'),
      path: ['new_password'],
    });
}

export const loginSchema = createLoginSchema();
export const registerSchema = createRegisterSchema();
export const forgotPasswordSchema = createForgotPasswordSchema();
export const resetPasswordSchema = createResetPasswordSchema();
export const mfaCodeSchema = createMfaCodeSchema();
export const mfaRecoverySchema = createMfaRecoverySchema();
export const changePasswordSchema = createChangePasswordSchema();

export type LoginFormData = z.infer<typeof loginSchema>;
export type RegisterFormData = z.infer<typeof registerSchema>;
export type ForgotPasswordFormData = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordFormData = z.infer<typeof resetPasswordSchema>;
export type MFACodeFormData = z.infer<typeof mfaCodeSchema>;
export type ChangePasswordFormData = z.infer<typeof changePasswordSchema>;
