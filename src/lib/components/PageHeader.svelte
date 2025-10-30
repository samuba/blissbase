<script lang="ts">
    let { backRoute, title = 'Blissbase' }: { backRoute: string, title?: string } = $props();
</script>

<div class="flex items-center justify-between px-4 max-w-2xl mx-auto">
    <a href="/" class="my-4 flex items-center justify-center gap-4">
        <img src="/favicon.png" alt="Blissbase" class="size-10 min-w-10" />
        <h1 class="text-base-content text-2xl font-bold">{title}</h1>
    </a>
 
    <a href={backRoute} class="btn-sm btn">
        <i class="icon-[ph--arrow-left] size-5"></i>
        Zurück
    </a>
</div>