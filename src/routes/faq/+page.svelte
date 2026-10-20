<script lang="ts">
	/* @wc-include */
	import { routes } from '$lib/routes';

	let { data } = $props();
	const faqRecentEventCounts = $derived(data.faqRecentEventCounts);
</script>

<div class="mx-auto w-full max-w-2xl px-4 py-4 md:py-0 md:pb-6">
	<div class="flex flex-col gap-4">
		<div class="card bg-base-100 p-6 shadow">
			<h1 class="text-2xl font-semibold">FAQ</h1>
			<p class="mt-2 text-base-content/75">
				Answers to the most common questions about Blissbase.
			</p>
		</div>

		<div class="card bg-base-100 p-6 shadow">
			<h2 class="text-lg font-semibold">What is Blissbase?</h2>
			<div class="mt-2 space-y-3 text-base-content/80">
				<p>
					Blissbase is your portal for expansion. We bring events and personal offerings together in
					one searchable place to support wellbeing, personal growth, and deep human connection.
				</p>
				<p>
					Spend less time searching and more time discovering what’s happening around you,
					finding your people, and taking part.
				</p>
			</div>
		</div>

		<div class="card bg-base-100 p-6 shadow">
			<h2 class="text-lg font-semibold">Welche Regionen werden unterstützt?</h2>
			<div class="mt-2 text-base-content/80">
				<p>
					Du kannst Blissbase weltweit nutzen – am besten unterstützt sind zur Zeit die Regionen
					hier, mit der Anzahl <b>neuer Events der letzten zwei Monate</b>.
				</p>
				{#if faqRecentEventCounts.regions?.length}
					<ul class="mt-3 space-y-1.5 text-sm">
						{#each faqRecentEventCounts.regions as region (region.key)}
							<li class="flex gap-4 border-b border-base-200 pb-1.5 last:border-0 last:pb-0">
								<span>{region.label}</span>
								<span class="grow"></span>
								<span class="shrink-0 tabular-nums font-medium">{region.count}</span>Neue Events
							</li>
						{/each}
					</ul>
				{:else}
					<p class="mt-2 text-sm italic">Für Regionen liegen gerade keine Zahlen vor.</p>
				{/if}
			</div>
		</div>

		<div class="card bg-base-100 p-6 shadow">
			<h2 class="text-lg font-semibold">Who is Blissbase for?</h2>
			<div class="mt-2 space-y-3 text-base-content/80">
				<p>For people looking for meaningful experiences and the people creating them.</p>
				<p>
					We call those exploring seekers, and those sharing their work providers. Providers include
					facilitators, teachers, event organizers, venues, schools, and retreat leaders.
				</p>
				<p>
					Whether you’re finding your community or bringing people together, you’re
					welcome here.
				</p>
			</div>
		</div>

		<div class="card bg-base-100 p-6 shadow">
			<h2 class="text-lg font-semibold">Is Blissbase free?</h2>
			<div class="mt-2 space-y-3 text-base-content/80">
				<p>
					Yes. Browsing, creating a profile, saving favorite events, and listing your events and
					offerings are free.
				</p>
				<p>Individual experiences may have their own price, set by the provider.</p>
			</div>
		</div>

		<div class="card bg-base-100 p-6 shadow">
			<h2 class="text-lg font-semibold">What’s the difference between Events and Offerings?</h2>
			<div class="mt-2 space-y-3 text-base-content/80">
				<p>
					Events happen at a scheduled time, such as a workshop, dance, festival, or community
					gathering.
				</p>
				<p>
					Offerings are personal sessions and services available on request, such as coaching,
					massage, or a private session. They can be available in person, online, or both.
				</p>
			</div>
		</div>

		<div class="card bg-base-100 p-6 shadow">
			<h2 class="text-lg font-semibold">Why create an account if I’m looking for experiences?</h2>
			<div class="mt-2 space-y-3 text-base-content/80">
				<p>
					Save events that catch your eye and keep them together under
					<a href={routes.favorites()} class="link font-semibold">Favorites</a>. Tap the heart on an
					event to come back to it when you’re making plans.
				</p>
				<p>
					You can browse without an account. To sign up, open
					<a href={routes.profile()} class="link font-semibold">Profile</a> and use Google or receive
					a login code by email.
				</p>
			</div>
		</div>

		<div class="card bg-base-100 p-6 shadow">
			<h2 class="text-lg font-semibold">Why create a profile if I offer events or services?</h2>
			<div class="mt-2 space-y-3 text-base-content/80">
				<p>
					Introduce yourself and bring your events, offerings, website, and social links together on
					one public page you can share.
				</p>
				<p>
					Your profile helps people discover your work and explore what else you offer. Creating your
					profile and publishing listings is free. Start through
					<a href={routes.profile()} class="link font-semibold">Profile</a>, using Google or an email
					login code.
				</p>
			</div>
		</div>

		<div class="card bg-base-100 p-6 shadow">
			<h2 class="text-lg font-semibold">How do I search for events?</h2>
			<div class="mt-2 space-y-3 text-base-content/80">
				<p>Search by keyword and combine these filters:</p>
				<ul class="list-disc space-y-2 pl-5">
					<li>
						<b>Categories:</b> Dance, Breathwork, Tantra, Meditation, Movement, Energy Work, Sound
						Healing, Bodywork, Music, Relationship, Personal Growth, Spirituality, and Ceremony.
						You’ll find even more under Other.
					</li>
					<li>
						<b>Location and distance:</b> Enter a city or postal code, then choose a search radius or
						Everywhere.
					</li>
					<li>
						<b>Time period:</b> Pick dates or choose This week, This weekend, Next week, Next 30 days,
						or All upcoming events.
					</li>
					<li><b>Attendance:</b> Choose In-Person or Online.</li>
				</ul>
				<p>
					Sort by start time or distance. If you’re finding little, widen your distance or
					dates, remove a category, or select Reset all filters.
				</p>
			</div>
		</div>

		<div class="card bg-base-100 p-6 shadow">
			<h2 class="text-lg font-semibold">Can I explore somewhere other than my current location?</h2>
			<div class="mt-2 space-y-3 text-base-content/80">
				<p>
					Yes. Blissbase helps you connect with your community at home and find your community while
					traveling.
				</p>
				<p>
					Change the location to wherever you’re heading and explore what’s happening
					there.
				</p>
			</div>
		</div>

		<div class="card bg-base-100 p-6 shadow">
			<h2 class="text-lg font-semibold">How do I find private sessions and services?</h2>
			<div class="mt-2 space-y-3 text-base-content/80">
				<p>
					Open <a href={routes.offeringsList()} class="link font-semibold">Offerings</a> and search by
					keyword, location, and distance. Select "Also show online offerings" to include sessions
					available remotely.
				</p>
			</div>
		</div>

		<div class="card bg-base-100 p-6 shadow">
			<h2 class="text-lg font-semibold">How do I get more information or book an event or offering?</h2>
			<div class="mt-2 space-y-3 text-base-content/80">
				<p>
					It depends on the event or offering and the provider. Use the contact details or booking
					instructions in the listing. These may include a link, WhatsApp, Telegram, email, or phone
					number. Some events don’t require registration.
				</p>
				<p>
					Some provider profiles also include website and Instagram buttons. For events collected from
					another platform, follow the Source link to the original listing.
				</p>
				<p>Ticketing through Blissbase is planned for the future.</p>
			</div>
		</div>

		<div class="card bg-base-100 p-6 shadow">
			<h2 class="text-lg font-semibold">How do I post my event?</h2>
			<div class="mt-2 space-y-3 text-base-content/80">
				<p>
					Select <a href={routes.newEvent()} class="link font-semibold">Add event</a> and enter the
					name, date, time, description, location or online format, and registration details. Add
					images, a price, and tags where relevant.
				</p>
				<p>
					Already have promotional text or a flyer? Use Auto-fill to help fill in the fields, then
					check the details before continuing.
				</p>
				<p>
					Keep your existing booking method by adding it under "Registration / Tickets via." For an
					event you only want to share by link, select "Don’t show event in search."
				</p>
				<p>
					You can also submit through
					<a
						href="https://t.me/blissbase_bot"
						target="_blank"
						rel="noopener noreferrer"
						class="link font-semibold">@blissbase_bot</a
					> on Telegram. Include the description, location, date, and image together in a single
					message.
				</p>
			</div>
		</div>

		<div class="card bg-base-100 p-6 shadow">
			<h2 class="text-lg font-semibold">How do I list my personal sessions or services?</h2>
			<div class="mt-2 space-y-3 text-base-content/80">
				<p>
					Open <a href={routes.offeringsList()} class="link font-semibold">Offerings</a> and select
					<a href={routes.newOffering()} class="link font-semibold">Add offering</a>. Add your title,
					description, images, and whether it’s available in person, online, or both.
				</p>
				<p>
					Your offering can appear on the Offerings page and in your public profile.
				</p>
			</div>
		</div>

		<div class="card bg-base-100 p-6 shadow">
			<h2 class="text-lg font-semibold">Where do Blissbase’s event listings come from?</h2>
			<div class="mt-2 space-y-3 text-base-content/80">
				<p>
					Providers post events directly, and Blissbase also gathers listings from public calendars,
					websites, and community channels.
				</p>
				<p>
					We bring the information together so you don’t have to search through separate
					websites, apps, and groups.
				</p>
			</div>
		</div>

		<div class="card bg-base-100 p-6 shadow">
			<h2 class="text-lg font-semibold">Where is Blissbase growing next?</h2>
			<div class="mt-2 space-y-3 text-base-content/80">
				<p>
					Our aim is to become the easiest place to find the most relevant experiences, wherever you
					find yourself on your journey.
				</p>
				<p>
					We’re focusing our expansion on spiritual hubs, including Ubud in Bali, San Marcos
					on Lake Atitlán in Guatemala, Ibiza, Tulum, Goa, and Koh Phangan. We also plan to grow into
					places with conscious communities, including Austin in the US and Byron Bay in Australia.
					More coming soon.
				</p>
			</div>
		</div>

		<div class="card bg-base-100 p-6 shadow">
			<h2 class="text-lg font-semibold">How can I help bring my local community to Blissbase?</h2>
			<div class="mt-2 space-y-3 text-base-content/80">
				<p>Would you like to see your city better represented? Help us open the door.</p>
				<p>
					Introduce us to local providers, share public event calendars and community channels, or
					connect us with the people bringing your community together.
				</p>
				<p>
					We welcome ambassadors and collaborators who want to bring their city’s experiences
					into one place. Email
					<a href="mailto:hi@blissbase.app" class="link font-semibold">hi@blissbase.app</a> with your
					location and how you’d like to contribute.
				</p>
			</div>
		</div>
	</div>
</div>
