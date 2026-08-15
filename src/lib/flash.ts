export const FLASH_COOKIE_NAME = `flash`;

export const FLASH_KEYS = [`offeringCreated`, `eventCreated`, `offeringListed`, `offeringUnlisted`, `offeringDeleted`, `offeringUpdated`, `eventUpdated`, `eventDeleted`] as const;

export type FlashKey = (typeof FLASH_KEYS)[number];
