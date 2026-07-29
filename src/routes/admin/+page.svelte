<script lang="ts">
	import { routes } from '$lib/routes';
</script>

<div class="mx-auto w-full max-w-2xl px-4 py-4 md:py-0 md:pb-10">
	<div class="card bg-base-100 mt-4 shadow">
		<div class="card-body gap-4">
			<div class="flex items-start gap-3">
				<div class="bg-primary/15 text-primary-content rounded-xl p-2.5">
					<i class="icon-[ph--shield-star] size-7"></i>
				</div>
				<div class="min-w-0 flex-1 space-y-2">
					<h1 class="text-lg font-semibold">Admin</h1>
					<p class="text-base-content/80 text-sm leading-relaxed">
						Event-Quellenfilter findest du im Filter-Dialog auf der Startseite.
					</p>
				</div>
			</div>

			<div class="flex gap-4 items-stretch pt-1">
				<a href={routes.adminTelegram()} class="btn justify-start grow">
					<i class="icon-[ph--telegram-logo] size-5 text-[#26A5E4]"></i>
					Telegram Scraping
				</a>
				<a href={routes.adminWhatsapp()} class="btn justify-start grow">
					<i class="icon-[ph--whatsapp-logo] size-5 text-[#25D366]"></i>
					WhatsApp Scraping
				</a>
			</div>
		</div>
	</div>
</div>
