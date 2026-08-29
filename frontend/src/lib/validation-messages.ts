import { DEFAULT_LOCALE } from './i18n';
import { getMessages, readMessage, type MessageKey } from './i18n/messages';

export type ValidationMessageKey = Extract<MessageKey, `validation.${string}`>;

export const VALIDATION_MESSAGE_KEYS = {
  emailRequired: 'validation.emailRequired',
  emailInvalid: 'validation.emailInvalid',
  passwordRequired: 'validation.passwordRequired',
  confirmPasswordRequired: 'validation.confirmPasswordRequired',
  passwordMismatch: 'validation.passwordMismatch',
  passwordMustChange: 'validation.passwordMustChange',
  passwordMin: 'validation.passwordMin',
  passwordMax: 'validation.passwordMax',
  passwordUppercase: 'validation.passwordUppercase',
  passwordLowercase: 'validation.passwordLowercase',
  passwordNumber: 'validation.passwordNumber',
  passwordSpecial: 'validation.passwordSpecial',
  organizationNameRequired: 'validation.organizationNameRequired',
  organizationNameMax: 'validation.organizationNameMax',
  industryRequired: 'validation.industryRequired',
  countryTwoLetter: 'validation.countryTwoLetter',
  countryInvalid: 'validation.countryInvalid',
  firstNameRequired: 'validation.firstNameRequired',
  firstNameMax: 'validation.firstNameMax',
  firstNameInvalid: 'validation.firstNameInvalid',
  lastNameRequired: 'validation.lastNameRequired',
  lastNameMax: 'validation.lastNameMax',
  lastNameInvalid: 'validation.lastNameInvalid',
  currentPasswordRequired: 'validation.currentPasswordRequired',
  mfaCodeSixDigits: 'validation.mfaCodeSixDigits',
  recoveryCodeRequired: 'validation.recoveryCodeRequired',
  recoveryCodeInvalid: 'validation.recoveryCodeInvalid',
} as const satisfies Record<string, ValidationMessageKey>;

export type ValidationMessageName = keyof typeof VALIDATION_MESSAGE_KEYS;
export type ValidationMessageResolver = (name: ValidationMessageName) => string;

export function getValidationMessage(
  name: ValidationMessageName,
  locale: string | null | undefined = DEFAULT_LOCALE,
): string {
  return readMessage(getMessages(locale), VALIDATION_MESSAGE_KEYS[name]);
}

export function createValidationMessageResolver(
  locale: string | null | undefined = DEFAULT_LOCALE,
): ValidationMessageResolver {
  return (name) => getValidationMessage(name, locale);
}
