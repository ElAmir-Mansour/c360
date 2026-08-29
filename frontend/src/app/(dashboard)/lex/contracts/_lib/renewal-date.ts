import { subDays } from 'date-fns';

/**
 * RENEWAL DATE DERIVATION
 *
 * A contract's renewal date is not an independent fact — it is the day the
 * renewal decision falls due, which is the expiry date pulled back by the
 * agreed notice period:
 *
 *   renewal_date = expiry_date - renewal_notice_days
 *
 * A contract expiring 3 Aug 2027 with 60 days' notice must be renewed or
 * cancelled by 4 Jun 2027. Leaving the column empty (as the create wizard used
 * to) makes every downstream renewal surface read "Not set" on a contract that
 * plainly has a renewal schedule, so both the form and the detail view derive
 * it from the two inputs the user actually supplies.
 *
 * Shared by the contract form dialog, the drafting wizard, and the key-dates
 * strip so a stored renewal date and a derived one never disagree.
 */
export function deriveRenewalDate(
  expiry: Date | string | null | undefined,
  noticeDays: number | null | undefined,
): Date | null {
  if (!expiry) {
    return null;
  }
  const expiryDate = expiry instanceof Date ? expiry : new Date(expiry);
  if (Number.isNaN(expiryDate.getTime())) {
    return null;
  }
  // A missing/negative notice period degenerates to "renews at expiry".
  const notice = Math.max(0, Math.trunc(noticeDays ?? 0));
  return subDays(expiryDate, notice);
}
