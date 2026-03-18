<script lang="ts">
    import { estimateEventCount } from '$lib/eventCount.remote';

    const eventCount = await estimateEventCount().then((count) => Math.floor(count / 1000) * 1000);
</script>

<div class="mx-auto w-full max-w-2xl px-4 py-4 md:pb-6 md:py-0">
	<div class="card bg-base-100 shadow p-6">
        <p class="">
            Ich will die achtsamen Communities Deutschlands zusammen bringen. 
            Dafür sammel ich Events (über <b>{eventCount}</b>)
            aus verschiedenen Quellen und machen sie hier zugänglich. Durchsuchbar, komfortabel, alles
            an einem Ort.
            <br />
            Ich hoffe dir gefällt meine Arbeit.
        </p>
        <div class="my-4 flex items-center gap-3">
            <img src="/me.jpg" alt="Samuel" class="size-12 min-w-12 rounded-full" />
            <div class="flex flex-col">
                <span>Peace, Love & Light 🌻</span>
                <i class="text-sm">Samuel</i>
            </div>
        </div>
        
        <p>
            PS. Das Projekt ist noch in den Kinderschuhen und ich weiß noch nicht wohin es sich
            entwickelt. Deshalb bin ich sehr dankbar für jedes Feedback, Ideen und Kooperation: <a
                href="mailto:hi@blissbase.app"
                class="link w-fit font-semibold"
            >
                hi@blissbase.app
            </a>
        </p>
    </div>
</div>
