<script lang="ts">
	import { google, outlook, yahoo, ics, type CalendarEvent } from 'calendar-link';
	import PopOver from './PopOver.svelte';

	let { event }: { event: CalendarEvent } = $props();

	const calendarProviders = [
		{
			name: 'Google',
			icon: 'icon-[logos--google-calendar]',
			getUrl: (event: CalendarEvent) => google(event)
		},
		{
			name: 'Apple',
			icon: 'icon-[logos--apple]',
			getUrl: (event: CalendarEvent) => ics(event)
		},
		{
			name: 'Outlook Online',
			icon: 'icon-[logos--microsoft-outlook-logo]',
			svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-.12979373 0 33.25199672 32">
  <path fill="#0364b8" d="M28.596 2H11.404A1.404 1.404 0 0 0 10 3.404V5l9.69 3L30 5V3.404A1.404 1.404 0 0 0 28.596 2z"/>
  <path fill="#0a2767" d="M31.65 17.405A11.341 11.341 0 0 0 32 16a.666.666 0 0 0-.333-.576l-.013-.008-.004-.002L20.812 9.24a1.499 1.499 0 0 0-.145-.083 1.5 1.5 0 0 0-1.334 0 1.49 1.49 0 0 0-.145.082L8.35 15.415l-.004.002-.012.007A.666.666 0 0 0 8 16a11.344 11.344 0 0 0 .35 1.405l11.492 8.405z"/>
  <path fill="#28a8ea" d="M24 5h-7l-2.021 3L17 11l7 6h6v-6z"/>
  <path fill="#0078d4" d="M10 5h7v6h-7z"/>
  <path fill="#50d9ff" d="M24 5h6v6h-6z"/>
  <path fill="#0364b8" d="m24 17-7-6h-7v6l7 6 10.832 1.768z"/>
  <path fill="none" d="M10.031 5H30"/>
  <path fill="#0078d4" d="M17 11h7v6h-7z"/>
  <path fill="#064a8c" d="M10 17h7v6h-7z"/>
  <path fill="#0078d4" d="M24 17h6v6h-6z"/>
  <path fill="#0a2767" d="m20.19 25.218-11.793-8.6.495-.87s10.745 6.12 10.909 6.212a.528.528 0 0 0 .42-.012l10.933-6.23.496.869z" opacity=".5"/>
  <path fill="#1490df" d="m31.667 16.577-.014.008-.003.002-10.838 6.174a1.497 1.497 0 0 1-1.46.091l3.774 5.061 8.254 1.797v.004A1.498 1.498 0 0 0 32 28.5V16a.666.666 0 0 1-.333.577z"/>
  <path d="M32 28.5v-.738l-9.983-5.688-1.205.687a1.497 1.497 0 0 1-1.46.091l3.774 5.061 8.254 1.797v.004A1.498 1.498 0 0 0 32 28.5z" opacity=".05"/>
  <path d="M31.95 28.883 21.007 22.65l-.195.11a1.497 1.497 0 0 1-1.46.092l3.774 5.061 8.254 1.797v.004a1.501 1.501 0 0 0 .57-.83z" opacity=".1"/>
  <path fill="#28a8ea" d="M8.35 16.59v-.01h-.01l-.03-.02A.65.65 0 0 1 8 16v12.5A1.498 1.498 0 0 0 9.5 30h21a1.503 1.503 0 0 0 .37-.05.637.637 0 0 0 .18-.06.142.142 0 0 0 .06-.02 1.048 1.048 0 0 0 .23-.13c.02-.01.03-.01.04-.03z"/>
  <path d="M18 24.667V8.333A1.337 1.337 0 0 0 16.667 7H10.03v7.456l-1.68.958-.005.002-.012.007A.666.666 0 0 0 8 16v.005V16v10h8.667A1.337 1.337 0 0 0 18 24.667z" opacity=".1"/>
  <path d="M17 25.667V9.333A1.337 1.337 0 0 0 15.667 8H10.03v6.456l-1.68.958-.005.002-.012.007A.666.666 0 0 0 8 16v.005V16v11h7.667A1.337 1.337 0 0 0 17 25.667z" opacity=".2"/>
  <path d="M17 23.667V9.333A1.337 1.337 0 0 0 15.667 8H10.03v6.456l-1.68.958-.005.002-.012.007A.666.666 0 0 0 8 16v.005V16v9h7.667A1.337 1.337 0 0 0 17 23.667z" opacity=".2"/>
  <path d="M16 23.667V9.333A1.337 1.337 0 0 0 14.667 8H10.03v6.456l-1.68.958-.005.002-.012.007A.666.666 0 0 0 8 16v.005V16v9h6.667A1.337 1.337 0 0 0 16 23.667z" opacity=".2"/>
  <path fill="#0078d4" d="M1.333 8h13.334A1.333 1.333 0 0 1 16 9.333v13.334A1.333 1.333 0 0 1 14.667 24H1.333A1.333 1.333 0 0 1 0 22.667V9.333A1.333 1.333 0 0 1 1.333 8z"/>
  <path fill="#fff" d="M3.867 13.468a4.181 4.181 0 0 1 1.642-1.814A4.965 4.965 0 0 1 8.119 11a4.617 4.617 0 0 1 2.413.62 4.14 4.14 0 0 1 1.598 1.733 5.597 5.597 0 0 1 .56 2.55 5.901 5.901 0 0 1-.577 2.666 4.239 4.239 0 0 1-1.645 1.794A4.8 4.8 0 0 1 7.963 21a4.729 4.729 0 0 1-2.468-.627 4.204 4.204 0 0 1-1.618-1.736 5.459 5.459 0 0 1-.567-2.519 6.055 6.055 0 0 1 .557-2.65zm1.75 4.258a2.716 2.716 0 0 0 .923 1.194 2.411 2.411 0 0 0 1.443.435 2.533 2.533 0 0 0 1.541-.449 2.603 2.603 0 0 0 .897-1.197 4.626 4.626 0 0 0 .286-1.665 5.063 5.063 0 0 0-.27-1.686 2.669 2.669 0 0 0-.866-1.24 2.387 2.387 0 0 0-1.527-.473 2.493 2.493 0 0 0-1.477.439 2.741 2.741 0 0 0-.944 1.203 4.776 4.776 0 0 0-.007 3.44z"/>
  <path fill="none" d="M0 0h32v32H0z"/>
</svg>
`,
			getUrl: (event: CalendarEvent) => outlook(event)
		},
		{
			name: 'Yahoo',
			icon: 'icon-[mdi--yahoo] text-purple-600',
			getUrl: (event: CalendarEvent) => yahoo(event)
		},
		{
			name: 'iCal Datei',
			icon: 'icon-[ph--calendar-blank]',
			getUrl: (event: CalendarEvent) => ics(event)
		}
	];
</script>

<PopOver contentClass="bg-base-100 p-2 shadow-lg" contentProps={{ align: 'center' }}>
	{#snippet trigger()}
		<button
			class="btn h-full rounded rounded-r-full py-1 pr-2 pl-1.5"
			title="Zum Kalender hinzufügen"
			aria-label="Zum Kalender hinzufügen"
		>
			<i class="icon-[ph--calendar-plus] size-6"></i>
		</button>
	{/snippet}

	{#snippet content()}
		<div class="z-50 flex flex-col gap-2">
			{#each calendarProviders as provider}
				<a
					href={provider.getUrl(event)}
					target="_blank"
					rel="noopener noreferrer"
					class="btn btn-ghost flex items-center justify-start gap-2"
					onclick={() => {
						// Close the popover after a short delay to allow the link to open
						setTimeout(() => {
							const closeButton = document.querySelector(
								'[data-bits-floating-content-wrapper] [data-popover-close]'
							);
							if (closeButton instanceof HTMLElement) {
								closeButton.click();
							}
						}, 200);
					}}
				>
					{#if provider.svg}
						<img
							src={`data:image/svg+xml;utf8,${encodeURIComponent(provider.svg)}`}
							alt=""
							class="size-6"
						/>
					{:else}
						<i class={`${provider.icon} size-6`}></i>
					{/if}
					<span>{provider.name}</span>
				</a>
			{/each}
		</div>
	{/snippet}
</PopOver>
