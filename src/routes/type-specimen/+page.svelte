<script lang="ts">
	import { replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { heroMobile, heroTablet, heroDesktopUrl } from '$lib/assets/hero-images';
	import { routes } from '$lib/routes';

	const fonts = [
		{
			id: `nunito`,
			name: `Nunito`,
			family: `"Nunito", sans-serif`,
			why: `Soft and round, but calm enough to read as a real brand title.`,
			weights: [200, 300, 400, 500, 600, 700, 800, 900],
			defaultWeight: 600,
		},
		{
			id: `geologica`,
			name: `Geologica`,
			family: `"Geologica", sans-serif`,
			why: `Earthy, slightly organic forms that feel grounded and natural on a hero.`,
			weights: [100, 200, 300, 400, 500, 600, 700, 800, 900],
			defaultWeight: 500,
		},
		{
			id: `pally`,
			name: `Pally`,
			family: `"Pally", sans-serif`,
			why: `Rounded and warm, with more adult proportions and a quiet smile.`,
			weights: [400, 500, 700],
			defaultWeight: 400,
		},
		{
			id: `hanken-grotesk`,
			name: `Hanken Grotesk`,
			family: `"Hanken Grotesk", sans-serif`,
			why: `Clean Scandinavian grotesk: clear at a glance, still a little human.`,
			weights: [100, 200, 300, 400, 500, 600, 700, 800, 900],
			defaultWeight: 500,
		},
		{
			id: `familjen-grotesk`,
			name: `Familjen Grotesk`,
			family: `"Familjen Grotesk", sans-serif`,
			why: `Slightly quirky shapes that feel handmade without going costume-hippie.`,
			weights: [400, 500, 600, 700],
			defaultWeight: 500,
		},
		{
			id: `gabarito`,
			name: `Gabarito`,
			family: `"Gabarito", sans-serif`,
			why: `Rounded geometry that stays friendly without getting bouncy.`,
			weights: [400, 500, 600, 700, 800, 900],
			defaultWeight: 500,
		},
		{
			id: `livvic`,
			name: `Livvic`,
			family: `"Livvic", sans-serif`,
			why: `Soft humanist titles with a quiet, uncommon calm.`,
			weights: [100, 200, 300, 400, 500, 600, 700, 900],
			defaultWeight: 500,
		},
		{
			id: `syne`,
			name: `Syne`,
			family: `"Syne", sans-serif`,
			why: `Wide and a bit artistic, so Blissbase looks like a cultural space, not a startup.`,
			weights: [400, 500, 600, 700, 800],
			defaultWeight: 500,
		},
		{
			id: `cabinet-grotesk`,
			name: `Cabinet Grotesk`,
			family: `"Cabinet Grotesk", sans-serif`,
			why: `Warm vintage grotesk with enough character to carry a wordmark.`,
			weights: [100, 200, 300, 400, 500, 700, 800, 900],
			defaultWeight: 500,
		},
		{
			id: `author`,
			name: `Author`,
			family: `"Author", sans-serif`,
			why: `Humanist and slightly written, which adds elegance without a serif.`,
			weights: [200, 300, 400, 500, 600, 700],
			defaultWeight: 500,
		},
		{
			id: `anek-latin`,
			name: `Anek Latin`,
			family: `"Anek Latin", sans-serif`,
			why: `Soft and a little irregular — human in a way that isn't Western-corporate.`,
			weights: [100, 200, 300, 400, 500, 600, 700, 800],
			defaultWeight: 500,
		},
		{
			id: `red-hat-display`,
			name: `Red Hat Display`,
			family: `"Red Hat Display", sans-serif`,
			why: `Built for headlines: friendly, open, and very easy to read.`,
			weights: [300, 400, 500, 600, 700, 800, 900],
			defaultWeight: 500,
		},
		{
			id: `grandstander`,
			name: `Grandstander`,
			family: `"Grandstander", sans-serif`,
			why: `Soft display type with a naive, festival-poster warmth.`,
			weights: [100, 200, 300, 400, 500, 600, 700, 800, 900],
			defaultWeight: 400,
		},
		{
			id: `quattrocento-sans`,
			name: `Quattrocento Sans`,
			family: `"Quattrocento Sans", sans-serif`,
			why: `Classical humanist sans — the elegant, un-cute option.`,
			weights: [400, 700],
			defaultWeight: 400,
		},
		{
			id: `figtree`,
			name: `Figtree`,
			family: `"Figtree", sans-serif`,
			why: `Modern and open, so title sizes stay clear and kind.`,
			weights: [300, 400, 500, 600, 700, 800, 900],
			defaultWeight: 600,
		},
		{
			id: `bricolage-grotesque`,
			name: `Bricolage Grotesque`,
			family: `"Bricolage Grotesque", sans-serif`,
			why: `Artisan irregularity that feels letterpress, not tech.`,
			weights: [200, 300, 400, 500, 600, 700, 800],
			defaultWeight: 500,
		},
		{
			id: `commissioner`,
			name: `Commissioner`,
			family: `"Commissioner", sans-serif`,
			why: `Low-contrast and slightly flared — a calm whisper of elegance.`,
			weights: [100, 200, 300, 400, 500, 600, 700, 800, 900],
			defaultWeight: 500,
		},
		{
			id: `inclusive-sans`,
			name: `Inclusive Sans`,
			family: `"Inclusive Sans", sans-serif`,
			why: `Intentionally imperfect, so it feels written by a person.`,
			weights: [300, 400, 500, 600, 700],
			defaultWeight: 500,
		},
		{
			id: `epilogue`,
			name: `Epilogue`,
			family: `"Epilogue", sans-serif`,
			why: `Soft flares give a hint of organic art-nouveau without decoration.`,
			weights: [100, 200, 300, 400, 500, 600, 700, 800, 900],
			defaultWeight: 500,
		},
		{
			id: `karla`,
			name: `Karla`,
			family: `"Karla", sans-serif`,
			why: `A grotesque with soul — grounded and clear, community rather than spa.`,
			weights: [200, 300, 400, 500, 600, 700, 800],
			defaultWeight: 500,
		},
		{
			id: `onest`,
			name: `Onest`,
			family: `"Onest", sans-serif`,
			why: `Contemporary proportions with a little oddness, so it isn't generic.`,
			weights: [100, 200, 300, 400, 500, 600, 700, 800, 900],
			defaultWeight: 500,
		},
		{
			id: `spline-sans`,
			name: `Spline Sans`,
			family: `"Spline Sans", sans-serif`,
			why: `Slightly rounded geometry that feels natural instead of icy-tech.`,
			weights: [300, 400, 500, 600, 700],
			defaultWeight: 500,
		},
	] as const;

	class SpecimenWeights {
		selected = $state<Record<string, number>>({});

		constructor() {
			for (const font of fonts) {
				this.selected[font.id] = weightFromParam({
					weights: font.weights,
					fallback: font.defaultWeight,
					raw: page.url.searchParams.get(font.id),
				});
			}
		}

		setWeight = ({ id, weight }: { id: string; weight: number }) => {
			this.selected[id] = weight;
			this.writeUrl(id);
		};

		shareFont = (id: string) => {
			this.writeUrl(id);
		};

		writeUrl = (id: string) => {
			const url = new URL(page.url);
			url.searchParams.set(id, String(this.selected[id]));
			url.hash = id;
			replaceState(`${routes.typeSpecimen()}${url.search}${url.hash}`, page.state);
		};
	}

	const specimen = new SpecimenWeights();

	function weightFromParam({
		weights,
		fallback,
		raw,
	}: {
		weights: readonly number[];
		fallback: number;
		raw: string | null;
	}) {
		const parsed = Number(raw);
		if (weights.some((weight) => weight === parsed)) return parsed;
		return fallback;
	}

	function weightIndex(font: (typeof fonts)[number]) {
		const current = specimen.selected[font.id] ?? font.defaultWeight;
		const index = font.weights.indexOf(current);
		return index === -1 ? 0 : index;
	}
</script>

<svelte:head>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		href="https://fonts.googleapis.com/css2?family=Anek+Latin:wght@100..800&family=Bricolage+Grotesque:opsz,wght@12..96,200..800&family=Commissioner:wght@100..900&family=Epilogue:wght@100..900&family=Familjen+Grotesk:wght@400..700&family=Figtree:wght@300..900&family=Gabarito:wght@400..900&family=Geologica:wght@100..900&family=Grandstander:wght@100..900&family=Hanken+Grotesk:wght@100..900&family=Inclusive+Sans:wght@300..700&family=Karla:wght@200..800&family=Livvic:wght@100;200;300;400;500;600;700;900&family=Nunito:wght@200..900&family=Onest:wght@100..900&family=Quattrocento+Sans:wght@400;700&family=Red+Hat+Display:wght@300..900&family=Spline+Sans:wght@300..700&family=Syne:wght@400..800&display=swap"
		rel="stylesheet"
	/>
	<link
		href="https://api.fontshare.com/v2/css?f[]=pally@400,500,700&f[]=cabinet-grotesk@100,200,300,400,500,700,800,900&f[]=author@200,300,400,500,600,700&display=swap"
		rel="stylesheet"
	/>
</svelte:head>

<div class="sticky top-0 z-50 bg-base-200 px-4 py-2">
	<div class="flex flex-wrap gap-1">
		{#each fonts as font (font.id)}
			<a
				href={`#${font.id}`}
				class="btn btn-xs"
				onclick={() => specimen.shareFont(font.id)}
			>
				{font.name}
			</a>
		{/each}
	</div>
</div>

<div class="flex flex-col gap-10">
	{#each fonts as font (font.id)}
		<section id={font.id} class="scroll-mt-20">
			<div class="bg-base-200 px-4 py-4">
				<div
					class="mx-auto flex max-w-4xl flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-center sm:gap-x-4 sm:gap-y-2"
				>
					<p
						class="text-lg"
						style:font-family={font.family}
						style:font-weight={specimen.selected[font.id]}
					>
						{font.name}
					</p>
					<p class="text-sm text-base-content/70 sm:max-w-md">
						{font.why}
					</p>
					{#if font.weights.length > 1}
						<label class="w-full max-w-xs">
							<span class="sr-only">Thickness {font.name}</span>
							<input
								type="range"
								class="range range-sm"
								min="0"
								max={font.weights.length - 1}
								step="1"
								bind:value={
									() => weightIndex(font),
									(index) =>
										specimen.setWeight({
											id: font.id,
											weight: font.weights[index] ?? font.defaultWeight,
										})
								}
							/>
							<div class="mt-2 flex justify-between px-2.5 text-xs text-base-content/50">
								{#each font.weights as weight (weight)}
									<span>|</span>
								{/each}
							</div>
							<div class="mt-1 flex justify-between px-2.5 text-[10px] tabular-nums text-base-content/70">
								{#each font.weights as weight (weight)}
									<span>{weight}</span>
								{/each}
							</div>
						</label>
					{/if}
				</div>
			</div>

			<div class="grid w-full overflow-hidden">
				<div class="col-start-1 row-start-1">
					<picture>
						{#each Object.entries(heroMobile.sources) as [format, srcset] (format)}
							<source media="(max-width: 499px)" {srcset} type={`image/${format}`} />
						{/each}
						<source
							media="(min-width: 1100px)"
							srcset={heroDesktopUrl}
							type="image/{heroDesktopUrl.split('.').pop()}"
						/>
						{#each Object.entries(heroTablet.sources) as [format, srcset] (`${font.id}-${format}`)}
							<source {srcset} type={`image/${format}`} />
						{/each}
						<img
							src={heroTablet.img.src}
							width={heroTablet.img.w}
							height={heroTablet.img.h}
							alt=""
							class="h-72 w-full object-cover md:h-auto md:max-h-[550px]"
						/>
					</picture>
				</div>

				<div
					class="col-start-1 row-start-1 z-10 container mx-auto sm:w-2xl flex flex-col gap-4 sm:gap-8 items-center justify-center"
				>
					<div class="flex flex-col gap-4 w-full items-center justify-center px-4">
						<div class="flex justify-center items-center gap-3">
							<img
								src="/logo-90x90.png"
								alt=""
								class="size-12 md:size-16 lg:size-18 drop-shadow-xl"
							/>
							<h1
								class="md:text-5xl text-4xl text-base-100"
								style:font-family={font.family}
								style:font-weight={specimen.selected[font.id]}
							>
								Blissbase
							</h1>
						</div>

						<h2
							class="text-lg sm:text-xl md:text-2xl bg-gradient-to-r from-base-100 to-base-100 bg-clip-text text-transparent text-center"
							style:font-family={font.family}
							style:font-weight={specimen.selected[font.id]}
						>
							<span class="text-yellow-400">✨</span> Achtsame Events in deiner Nähe
							<span class="text-yellow-400">✨</span>
						</h2>
					</div>
				</div>
			</div>
		</section>
	{/each}
</div>
