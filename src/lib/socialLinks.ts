export const PROFILE_SOCIAL_TYPES = [
	`website`,
	`instagram`,
	`tiktok`,
	`telegram`,
	`whatsapp`,
	`facebook`,
	`youtube`,
	`email`,
    `phone`
] as const;

export type ProfileSocialType = (typeof PROFILE_SOCIAL_TYPES)[number];

export function socialIconClass(type: ProfileSocialType) {
    if (type === `instagram`) return `icon-[ph--instagram-logo]`;
    if (type === `tiktok`) return `icon-[ph--tiktok-logo]`;
    if (type === `facebook`) return `icon-[ph--facebook-logo]`;
    if (type === `website`) return `icon-[ph--globe]`;
    if (type === `telegram`) return `icon-[ph--telegram-logo]`;
    if (type === `whatsapp`) return `icon-[ph--whatsapp-logo]`;
    if (type === `youtube`) return `icon-[ph--youtube-logo]`;
    if (type === `email`) return `icon-[ph--envelope-simple]`;
    if (type === `phone`) return `icon-[ph--phone]`;
    return `icon-[ph--link]`;
}

export function socialLabel(type: ProfileSocialType) {
    if (type === `instagram`) return `Instagram`;
    if (type === `tiktok`) return `TikTok`;
    if (type === `facebook`) return `Facebook`;
    if (type === `youtube`) return `YouTube`;
    if (type === `website`) return `Website`;
    if (type === `telegram`) return `Telegram`;
    if (type === `whatsapp`) return `WhatsApp`;
    if (type === `email`) return `E-Mail`;
    if (type === `phone`) return `Telefon`;
    return `Link`;
}

export function usernameUrlPrefix(type?: ProfileSocialType) {
    if (type === `instagram`) return `https://instagram.com/`;
    if (type === `tiktok`) return `https://tiktok.com/@`;
    if (type === `facebook`) return `https://facebook.com/`;
    if (type === `youtube`) return `https://youtube.com/@`;
}

export function socialIconColorClass(type: ProfileSocialType) {
    if (type === `instagram`) return `text-[#E4405F]`;
    if (type === `tiktok`) return `text-[#000000]`;
    if (type === `facebook`) return `text-[#1877F2]`;
    if (type === `website`) return `text-sky-500`;
    if (type === `telegram`) return `text-[#26A5E4]`;
    if (type === `whatsapp`) return `text-[#25D366]`;
    if (type === `youtube`) return `text-[#FF0000]`;
    if (type === `email`) return `text-[#EA4335]`;
    if (type === `phone`) return `text-[#25D366]`;
    return `text-base-content/70`;
}