import { browser } from "$app/environment";

/** Canvas burst, lazy-loaded so the library stays out of the initial bundle. */
export async function fireConfetti() {
	if (!browser) return;

	const { default: confetti } = await import(`canvas-confetti`);
	const defaults = {
		origin: { y: 0.65 },
		disableForReducedMotion: true,
		zIndex: 180,
		colors: [`#fef08a`, `#fde047`, `#facc15`, `#eab308`, `#ca8a04`, `#a16207`, `#854d0e`],
	};

	await Promise.all([
		confetti({ ...defaults, particleCount: 50, spread: 26, startVelocity: 55 }),
		confetti({ ...defaults, particleCount: 40, spread: 60 }),
		confetti({ ...defaults, particleCount: 70, spread: 100, decay: 0.91, scalar: 0.8 }),
		confetti({ ...defaults, particleCount: 20, spread: 120, startVelocity: 25, decay: 0.92, scalar: 1.2 }),
		confetti({ ...defaults, particleCount: 20, spread: 120, startVelocity: 45 }),
	]);
}
