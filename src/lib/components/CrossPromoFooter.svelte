<script lang="ts">
	let {
		icon,
		title,
		description,
		href,
		linkLabel,
		testId,
	}: {
		icon: string;
		title: string;
		description: string;
		href: string;
		linkLabel: string;
		testId: string;
	} = $props();
</script>

<section class="card bg-base-100 mt-4 shadow-sm" data-testid={testId}>
	<div class="card-body flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
		<div>
			<h2 class="card-title">
				<i class={[icon, `size-6`]}></i>
				{title}
			</h2>
			<p class="text-base-content/70 text-sm">{description}</p>
		</div>
		<a {href} class="btn" data-testid={`${testId}-link`}>
			{linkLabel}
			<i class="icon-[ph--arrow-right] size-5"></i>
		</a>
	</div>
</section>
