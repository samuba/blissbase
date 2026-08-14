<script lang="ts">
	import { routes } from '$lib/routes';
</script>

<div class="mx-auto w-full max-w-2xl px-4 py-4 md:py-0 md:pb-10">
	<div class="card bg-base-100 mt-4 shadow">
		<div class="card-body gap-4">
			<div class="flex items-start gap-3">
				<div class="bg-primary/15 text-primary-content flex size-12 shrink-0 items-center justify-center rounded-xl">
					<i class="icon-[ph--shield-star] block size-7"></i>
				</div>
				<div class="min-w-0 flex-1 space-y-2">
					<h1 class="text-lg font-semibold">Admin</h1>
					<p class="text-base-content/80 text-sm leading-relaxed">
						Event-Quellenfilter findest du im Filter-Dialog auf der Startseite.
					</p>
				</div>
			</div>
		</div>
	</div>

	<div class="card bg-base-100 mt-4 overflow-hidden shadow">
		<ul class="list">
			<li>
				<a href={routes.adminTelegram()} class="list-row hover:bg-base-200 items-start no-underline">
					<div class="bg-base-200 flex size-12 shrink-0 items-center justify-center rounded-xl">
						<i class="icon-[ph--telegram-logo] block size-7 text-[#26A5E4]"></i>
					</div>
					<div class="list-col-grow">
						<h3 class="text-lg font-semibold">Telegram Scraping</h3>
					</div>
					<i class="icon-[ph--caret-right] text-base-content/40 size-5 self-center"></i>
				</a>
			</li>
			<li>
				<a href={routes.adminWhatsapp()} class="list-row hover:bg-base-200 items-start no-underline">
					<div class="bg-base-200 flex size-12 shrink-0 items-center justify-center rounded-xl">
						<i class="icon-[ph--whatsapp-logo] block size-7 text-[#25D366]"></i>
					</div>
					<div class="list-col-grow">
						<h3 class="text-lg font-semibold">WhatsApp Scraping</h3>
					</div>
					<i class="icon-[ph--caret-right] text-base-content/40 size-5 self-center"></i>
				</a>
			</li>
		</ul>
	</div>
</div>
