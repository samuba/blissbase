export const FLASH_COOKIE_NAME = `flash`;

export const FLASH_KEYS = [`offeringCreated`, `offeringListed`, `offeringUnlisted`, `offeringDeleted`] as const;

export type FlashKey = (typeof FLASH_KEYS)[number];
