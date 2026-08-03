import { describe, expect, test } from 'vitest';

import { sanitizeProfileSummary } from './profileSummary';

describe('sanitizeProfileSummary', () => {
  test('removes retired credits campaign fields before exposing profile data', () => {
    const input = {
      id: 42,
      nickname: 'Lobster',
      totalCreditsRemaining: 5000,
      availableResetCount: 1,
      availablePromoSubscriptionCount: 1,
      creditsResetCampaign: {
        enabled: true,
      },
    };

    expect(sanitizeProfileSummary(input)).toEqual({
      id: 42,
      nickname: 'Lobster',
      totalCreditsRemaining: 5000,
    });
    expect(input).toHaveProperty('creditsResetCampaign');
  });
});
