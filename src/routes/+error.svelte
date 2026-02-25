<script lang="ts">
	import { page } from '$app/state';
	import { routes } from '$lib/routes';
</script>

<div class="bg-base-100 flex min-h-screen items-center justify-center text-center">
	<div class="flex flex-col gap-8">
		<a href="/" class="flex items-center gap-3">
			<img src="/logo.svg" alt="Blissbase" class="size-12" />
			<h1 class="text-3xl font-bold font-brand">Blissbase</h1>
		</a>

		<div>
			<h1 class="text-2xl font-bold">Fehler {page.status}:</h1>
			<pre class="">{page.error?.message}</pre>
		</div>
		<div>
			<a href={routes.root()} class="btn btn-primary">
				<i class="icon-[ph--arrow-left] size-5"></i>
				Zur Startseite 
			</a>
		</div>
	</div>
</div>
