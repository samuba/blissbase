<script lang="ts">
	let { seed, class: className }: { seed: string; class?: string } = $props();

	// Curated array of aesthetically pleasing hue rotation values
	const pleasingHueRotations = [0, 10, 20, 30, 35, 290, 300, 310, 320, 330, 340, 350, 360];

	// get hash number from seed for hue rotation selection
	const seedHash = $derived(
		seed ? seed.split('').reduce((acc, char) => (acc * 31 + char.charCodeAt(0)) % 360, 0) : 0
	);

	// select hue rotation from curated array
	const selectedHueRotation = $derived(
		pleasingHueRotations[seedHash % pleasingHueRotations.length]
	);

	// generate rotation angle from seed (0-360 degrees) with better distribution
	const rotationAngle = $derived(
		seed
			? seed.split('').reduce((acc, char, index) => {
					const charCode = char.charCodeAt(0);
					return (acc + charCode * (index + 1) * 17) % 360;
				}, 0)
			: 0
	);

	const hueRotationStyle = $derived(`filter:hue-rotate(${selectedHueRotation}deg);`);
	const transformStyle = $derived(`transform: rotate(${rotationAngle}deg) scale(${1.5});`);
</script>

<div class={`overflow-hidden saturate-80 ${className}`}>
	<img
		src={'/event-placeholder.png'}
		alt="placeholder logo"
		title={`Hue: ${selectedHueRotation}°, Rotation: ${rotationAngle}°`}
		class="h-full w-full object-cover"
		style={`${hueRotationStyle} ${transformStyle}`}
	/>
</div>
