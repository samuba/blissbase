<script lang="ts">
	import { resolve } from '$app/paths';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import { routes } from '$lib/routes';
</script>

<PageHeader backRoute={routes.root()} />

<div class="mx-auto w-full max-w-3xl px-0 pb-10 sm:px-4">
	<div class="card bg-base-100 sm:rounded-box w-full rounded-none">
		<div class="card-body gap-4 p-4 sm:p-6">
			<div>
				<h1 class="text-2xl font-bold">How do you want to create your event?</h1>
				<p class="text-base-content/80 mt-1 text-sm">
					Choose the option that fits your workflow.
				</p>
			</div>

			<!-- <div class="card bg-primary/10">
				<div class="card-body gap-3">
					<h2 class="card-title flex items-center gap-2">
						<i class="icon-[ph--globe] size-6"></i>
						Directly on Blissbase
					</h2>
					<p class="text-sm">Use the website form and publish your event right away.</p>
					<div class="card-actions">
						<a href={resolve('/new')} class="btn btn-primary btn-sm sm:btn-md">
							Open website form
							<i class="icon-[ph--arrow-right] size-5"></i>
						</a>
					</div>
				</div>
			</div> -->

			<div class="card bg-info/15">
				<div class="card-body gap-3">
					<h2 class="card-title flex items-center gap-2">
						<i class="icon-[ph--telegram-logo] size-6"></i>
						Telegram bot
					</h2>
					<p class="text-sm">
						Send your event to the bot in one message including description, location, date and image.
					</p>
					<div class="card-actions">
						<a
							href="https://t.me/blissbase_bot"
							target="_blank"
							rel="noopener noreferrer"
							class="btn btn-info btn-sm bg-info/70 hover:bg-info sm:btn-md"
						>
							Send to Telegram bot
							<i class="icon-[ph--arrow-right] size-5"></i>
						</a>
					</div>
				</div>
			</div>

			<div class="card bg-accent/30">
				<div class="card-body gap-3">
					<h2 class="card-title flex items-center gap-2">
						<i class="icon-[ph--book-open] size-6"></i>
						Event sources
					</h2>
					<p class="text-sm">
						Add your event to one of the tracked sources. It usually appears on Blissbase within half a
						day.
					</p>
					<div class="card-actions">
						<a href={resolve('/sources')} class="btn btn-accent btn-sm sm:btn-md">
							Show event sources
							<i class="icon-[ph--arrow-right] size-5"></i>
						</a>
					</div>
				</div>
			</div>
		</div>
	</div>
</div>
