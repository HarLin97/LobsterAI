const RetiredCreditsCampaignProfileField = {
  AvailablePromoSubscriptionCount: 'availablePromoSubscriptionCount',
  AvailableResetCount: 'availableResetCount',
  CreditsResetCampaign: 'creditsResetCampaign',
} as const;

const retiredCreditsCampaignProfileFields = Object.values(
  RetiredCreditsCampaignProfileField,
);

export const sanitizeProfileSummary = (
  profileSummary: Record<string, unknown>,
): Record<string, unknown> => {
  const sanitized = { ...profileSummary };
  for (const field of retiredCreditsCampaignProfileFields) {
    delete sanitized[field];
  }
  return sanitized;
};
