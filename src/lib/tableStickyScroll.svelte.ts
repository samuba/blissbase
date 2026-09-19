import { untrack } from 'svelte';

/**
 * Sticky horizontal scrollbar for wide admin tables.
 * Element refs stay non-reactive: `{@attach}` runs inside an effect and
 * re-runs when it reads `$state`. Storing the nodes in `$state` previously
 * looped (`effect_update_depth_exceeded`) on the WhatsApp and Telegram admin pages.
 */
export class TableStickyScroll {
	tableScrollWidth = $state(0);
	#tableScrollEl: HTMLDivElement | null = null;
	#stickyScrollEl: HTMLDivElement | null = null;
	#syncingScroll = false;

	updateTableScrollWidth = () => {
		const nextWidth = this.#tableScrollEl?.querySelector(`table`)?.scrollWidth ?? 0;
		untrack(() => {
			if (this.tableScrollWidth === nextWidth) return;
			this.tableScrollWidth = nextWidth;
		});
	};

	syncStickyFromTable = () => {
		if (!this.#tableScrollEl || !this.#stickyScrollEl || this.#syncingScroll) return;
		this.#syncingScroll = true;
		this.#stickyScrollEl.scrollLeft = this.#tableScrollEl.scrollLeft;
		this.#syncingScroll = false;
	};

	syncTableFromSticky = () => {
		if (!this.#tableScrollEl || !this.#stickyScrollEl || this.#syncingScroll) return;
		this.#syncingScroll = true;
		this.#tableScrollEl.scrollLeft = this.#stickyScrollEl.scrollLeft;
		this.#syncingScroll = false;
	};

	tableScrollAttach = (node: HTMLDivElement) => {
		this.#tableScrollEl = node;
		const table = node.querySelector(`table`);
		const observer = new ResizeObserver(() => this.updateTableScrollWidth());
		observer.observe(node);
		if (table) observer.observe(table);
		this.updateTableScrollWidth();

		return () => {
			observer.disconnect();
			if (this.#tableScrollEl === node) this.#tableScrollEl = null;
		};
	};

	stickyScrollAttach = (node: HTMLDivElement) => {
		this.#stickyScrollEl = node;
		return () => {
			if (this.#stickyScrollEl === node) this.#stickyScrollEl = null;
		};
	};
}
