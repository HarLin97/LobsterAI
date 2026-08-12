// One capsule per card, its label carrying the state (Install / Use / Upgrade).
// A grid where every card shouts a filled primary button reads as a wall of ads
// and stops being browsable, so the capsule stays quiet at rest and only fills
// in under the cursor.
export const CARD_ACTION_PILL_CLASS =
  'inline-flex h-[26px] flex-shrink-0 items-center gap-1 rounded-full bg-surface-raised px-3 '
  + 'text-[11px] font-semibold text-primary transition-colors hover:bg-primary hover:text-white '
  + 'disabled:cursor-not-allowed disabled:opacity-50';

/** Same capsule, sized for a detail header where it is the one loud action. */
export const DETAIL_ACTION_PILL_CLASS =
  'inline-flex h-8 flex-shrink-0 items-center gap-1.5 rounded-full bg-primary px-5 '
  + 'text-[13px] font-semibold text-white transition-colors hover:bg-primary-hover '
  + 'disabled:cursor-not-allowed disabled:opacity-50';
