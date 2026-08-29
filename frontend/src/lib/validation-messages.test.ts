import { describe, expect, it } from 'vitest';
import {
  createValidationMessageResolver,
  getValidationMessage,
  VALIDATION_MESSAGE_KEYS,
} from './validation-messages';
import { getMessages, listMessageKeys } from './i18n/messages';

describe('validation message helpers', () => {
  it('reads Arabic validation copy by default', () => {
    expect(getValidationMessage('emailRequired')).toBe('البريد الإلكتروني مطلوب');
  });

  it('normalizes region variants before reading validation copy', () => {
    expect(getValidationMessage('emailInvalid', 'en-US')).toBe(
      'Please enter a valid email address',
    );
    expect(getValidationMessage('passwordMismatch', 'ar-SA')).toBe(
      'كلمتا المرور غير متطابقتين',
    );
  });

  it('creates reusable locale-bound validation resolvers', () => {
    const t = createValidationMessageResolver('en');

    expect(t('mfaCodeSixDigits')).toBe('Code must be 6 digits');
  });

  it('keeps exported validation names unique', () => {
    const keys = Object.values(VALIDATION_MESSAGE_KEYS);

    expect(new Set(keys).size).toBe(keys.length);
  });

  it('covers every validation key in the message catalog', () => {
    const catalogKeys = listMessageKeys(getMessages('en')).filter((key) =>
      key.startsWith('validation.'),
    );

    expect(Object.values(VALIDATION_MESSAGE_KEYS).sort()).toEqual(catalogKeys);
  });
});
