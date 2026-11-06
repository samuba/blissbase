import type { Page, Locator } from "@playwright/test";
import { expect, test } from "./helpers/fixtures";
import { waitForClientHydration } from "./helpers/offering-test-utils";

test.beforeEach(async ({ page }) => {
	await page.addInitScript(() => {
		if (sessionStorage.getItem(`keep-hint-dismissal`) === `1`) return;
		localStorage.removeItem(`blissbase_offerings_nav_hint_dismissed`);
	});
});

test.describe(`hint bubble positioning`, () => {
	test(`flips at viewport edges and stays inside the screen`, async ({ page }) => {
		await openHarness(page, `top`);
		await expect(page.getByTestId(`top-hint`)).toHaveAttribute(`data-side`, `bottom`);
		await expectAttached(page, `top-hint`, `top-anchor`);

		await openHarness(page, `bottom`);
		await expect(page.getByTestId(`bottom-hint`)).toHaveAttribute(`data-side`, `top`);
		await expectAttached(page, `bottom-hint`, `bottom-anchor`);
	});

	test(`follows an anchor inside a scroll container and hides when it leaves`, async ({ page }) => {
		await openHarness(page, `scroll`);
		const scrollBox = page.getByTestId(`scroll-box`);

		await placeAnchor(scrollBox, `scroll-anchor`, { fromTop: 160 });
		await expect(page.getByTestId(`scroll-hint`)).toHaveAttribute(`data-side`, `top`);
		await expectAttached(page, `scroll-hint`, `scroll-anchor`, `scroll-box`);

		const before = await box(page.getByTestId(`scroll-hint`));
		await placeAnchor(scrollBox, `scroll-anchor`, { fromTop: 80 });
		await expect.poll(async () => (await box(page.getByTestId(`scroll-hint`))).y).not.toBe(before.y);
		await expectAttached(page, `scroll-hint`, `scroll-anchor`, `scroll-box`);

		await placeAnchor(scrollBox, `scroll-anchor`, { fromTop: 8 });
		await expect(page.getByTestId(`scroll-hint`)).toHaveAttribute(`data-side`, `bottom`);
		await expectAttached(page, `scroll-hint`, `scroll-anchor`, `scroll-box`);

		await placeAnchor(scrollBox, `scroll-anchor`, { fromTop: -80 });
		await expect(page.getByTestId(`scroll-hint`)).toBeHidden();

		await placeAnchor(scrollBox, `scroll-anchor`, { fromTop: 160 });
		await expect(page.getByTestId(`scroll-hint`)).toBeVisible();
		await expectAttached(page, `scroll-hint`, `scroll-anchor`, `scroll-box`);
	});

	test(`flips above an anchor pinned to the bottom of a scroll container`, async ({ page }) => {
		await openHarness(page, `scroll-bottom`);
		await expect(page.getByTestId(`scroll-bottom-hint`)).toBeHidden();

		await placeAnchor(page.getByTestId(`scroll-box`), `scroll-bottom-anchor`, { fromBottom: 12 });
		await expect(page.getByTestId(`scroll-bottom-hint`)).toHaveAttribute(`data-side`, `top`);
		await expectAttached(page, `scroll-bottom-hint`, `scroll-bottom-anchor`, `scroll-box`);
	});

	test(`follows page scroll, flips near the top, and hides off-screen`, async ({ page }) => {
		await openHarness(page, `page`);

		await reveal(page, `page-anchor`);
		await expect(page.getByTestId(`page-hint`)).toBeVisible();
		await expectAttached(page, `page-hint`, `page-anchor`);

		await page.getByTestId(`page-anchor`).evaluate((node) => {
			const top = node.getBoundingClientRect().top + window.scrollY;
			window.scrollTo(0, Math.max(0, top - 8));
		});
		await expect(page.getByTestId(`page-hint`)).toHaveAttribute(`data-side`, `bottom`);
		await expectAttached(page, `page-hint`, `page-anchor`);

		await page.getByTestId(`page-anchor`).evaluate((node) => {
			const top = node.getBoundingClientRect().top + window.scrollY;
			window.scrollTo(0, top + node.getBoundingClientRect().height + 80);
		});
		await expect(page.getByTestId(`page-hint`)).toBeHidden();
	});

	test(`keeps the real nav and location hints with their anchors`, async ({ page }) => {
		await openHarness(page, `offerings`);

		const navHint = page.getByTestId(`offerings-nav-hint`);
		await expect(navHint).toBeVisible();
		await expectAttached(page, `offerings-nav-hint`, `nav-offerings`);
		await scrollWindow(page, 700);
		await expect(navHint).toBeVisible();
		await expectAttached(page, `offerings-nav-hint`, `nav-offerings`);

		await openHarness(page, `location`);
		await page.getByTestId(`location-anchor`).evaluate((node) => {
			const top = node.getBoundingClientRect().top + window.scrollY;
			window.scrollTo(0, Math.max(0, top - 8));
		});
		await expect(page.getByTestId(`auto-location-hint`)).toHaveAttribute(`data-side`, `bottom`);
		await expectAttached(page, `auto-location-hint`, `location-anchor`);

		await page.getByTestId(`location-anchor`).evaluate((node) => {
			const top = node.getBoundingClientRect().top + window.scrollY;
			window.scrollTo(0, top + node.getBoundingClientRect().height + 80);
		});
		await expect(page.getByTestId(`auto-location-hint`)).toBeHidden();
	});

	test(`keeps dismissal on the close button while scrolling and clicking outside`, async ({ page }) => {
		await openHarness(page, `top`);
		const hint = page.getByTestId(`top-hint`);
		await expect(hint).toBeVisible();

		await page.mouse.wheel(0, 400);
		await expect(hint).toBeVisible();
		await page.keyboard.press(`Escape`);
		await expect(hint).toBeVisible();
		await page.mouse.click(640, 360);
		await expect(hint).toBeVisible();

		await page.getByTestId(`top-hint-close`).click();
		await expect(hint).toBeHidden();
		await expect(page.locator(`[data-testid$="hint"]:visible`)).toHaveCount(0);
	});

	test(`exposes a non-modal status hint and respects reduced motion`, async ({ page }) => {
		await page.emulateMedia({ reducedMotion: `reduce` });
		await openHarness(page, `top`);
		const hint = page.getByTestId(`top-hint`);
		await expect(hint).toHaveAttribute(`role`, `status`);
		await expect(hint).not.toHaveAttribute(`aria-modal`, `true`);

		const outside = page.getByTestId(`outside-button`);
		await outside.focus();
		await page.keyboard.press(`Tab`);
		await expect(outside).not.toBeFocused();
		await outside.focus();
		await expect(outside).toBeFocused();

		const animation = await hint.locator(`.hint-nudge`).evaluate((node) => getComputedStyle(node).animationName);
		expect(animation === `none` || animation === ``).toBeTruthy();
	});

	test(`stays fixed on the anchor while the page scrolls`, async ({ page }) => {
		await openHarness(page, `top`);
		const drift = await page.evaluate(() => {
			const hint = document.querySelector(`[data-testid="top-hint"]`);
			const anchor = document.querySelector(`[data-testid="top-anchor"]`);
			const wrapper = hint?.closest(`[data-bits-floating-content-wrapper]`);
			if (!(wrapper instanceof HTMLElement) || !(anchor instanceof HTMLElement)) return null;
			const gap = () => Math.abs(wrapper.getBoundingClientRect().top - anchor.getBoundingClientRect().top);
			const before = gap();
			window.scrollTo(0, window.scrollY + 280);
			return { position: getComputedStyle(wrapper).position, before, during: gap() };
		});
		expect(drift?.position).toBe(`fixed`);
		expect(Math.abs((drift?.during ?? 0) - (drift?.before ?? 0))).toBeLessThan(2);
	});

	test(`repositions when the viewport is resized`, async ({ page }) => {
		await openHarness(page, `page`);
		await reveal(page, `page-anchor`);
		await expectAttached(page, `page-hint`, `page-anchor`);
		await page.setViewportSize({ width: 820, height: 640 });
		await expectAttached(page, `page-hint`, `page-anchor`);
	});

	test(`shows one hint at a time`, async ({ page }) => {
		await openHarness(page, `product`);
		await page.getByTestId(`location-anchor`).scrollIntoViewIfNeeded();
		const visible = page.locator(`[data-testid$="hint"]:visible`);
		await expect(visible).toHaveCount(1);
		const first = await visible.getAttribute(`data-testid`);
		await page.locator(`[data-testid$="hint-close"]:visible`).click();
		await page.getByTestId(`location-anchor`).scrollIntoViewIfNeeded();
		await expect(visible).toHaveCount(1);
		const second = await visible.getAttribute(`data-testid`);
		expect(new Set([first, second])).toEqual(new Set([`auto-location-hint`, `offerings-nav-hint`]));
		await page.locator(`[data-testid$="hint-close"]:visible`).click();
		await expect(visible).toHaveCount(0);
	});
});

test.describe(`hint bubbles on the homepage`, () => {
	test(`desktop offerings hint stays with the sticky nav while scrolling`, async ({ page }) => {
		await openHome(page);
		await stretchStickyFeed(page);
		await scrollWindow(page, 2300);
		await expectAttached(page, `offerings-nav-hint`, `nav-offerings`);
		const before = await box(page.locator(`[data-testid="nav-offerings"]:visible`));
		await scrollWindow(page, 2800);
		await expectAttached(page, `offerings-nav-hint`, `nav-offerings`);
		const after = await box(page.locator(`[data-testid="nav-offerings"]:visible`));
		expect(Math.abs(before.y - after.y)).toBeLessThan(4);

		await page.locator(`[data-testid="offerings-nav-hint-close"]:visible`).click();
		await expect(page.getByTestId(`offerings-nav-hint`)).toBeHidden();
		await page.evaluate(() => sessionStorage.setItem(`keep-hint-dismissal`, `1`));
		await page.reload();
		await waitForClientHydration(page);
		await scrollWindow(page, 2400);
		await expect(page.getByTestId(`offerings-nav-hint`)).toHaveCount(0);
	});

	test(`mobile offerings hint stays above the tab bar while scrolling`, async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await openHome(page);
		await scrollWindow(page, 2300);
		const hint = page.getByTestId(`offerings-nav-hint`);
		await expect(hint).toHaveAttribute(`data-side`, `top`);
		await expectAttached(page, `offerings-nav-hint`, `nav-offerings`);
		await scrollWindow(page, 2700);
		await expect(hint).toBeVisible();
		await expectAttached(page, `offerings-nav-hint`, `nav-offerings`);
	});
});

async function openHarness(page: Page, only?: string) {
	const path = only ? `/dev/hint-position?only=${only}` : `/dev/hint-position`;
	await page.goto(path);
	await waitForClientHydration(page);
}

async function openHome(page: Page) {
	await page.goto(`/`);
	await waitForClientHydration(page);
	await page.evaluate(() => {
		document.body.style.minHeight = `4000px`;
	});
}

async function stretchStickyFeed(page: Page) {
	await page.evaluate(() => {
		const header = document.getElementById(`header-controls`);
		const parent = header?.parentElement ?? document.body;
		const spacer = document.createElement(`div`);
		spacer.style.height = `3200px`;
		parent.append(spacer);
	});
}

async function scrollWindow(page: Page, top: number) {
	await page.evaluate((y) => window.scrollTo(0, y), top);
}

async function reveal(page: Page, testId: string) {
	await page.getByTestId(testId).evaluate((node) => {
		node.scrollIntoView({ block: `center`, inline: `nearest` });
	});
}

async function placeAnchor(scrollBox: Locator, anchorTestId: string, placement: { fromTop?: number; fromBottom?: number }) {
	await scrollBox.evaluate(
		(node, args) => {
			const anchor = node.querySelector(`[data-testid="${args.anchorTestId}"]`);
			if (!(anchor instanceof HTMLElement)) return;
			if (args.fromBottom != null) {
				node.scrollTop = anchor.offsetTop + anchor.offsetHeight - node.clientHeight + args.fromBottom;
				return;
			}
			node.scrollTop = anchor.offsetTop - (args.fromTop ?? 0);
		},
		{ anchorTestId, ...placement },
	);
}

async function box(locator: Locator) {
	const value = await locator.boundingBox();
	if (!value) throw new Error(`Missing bounding box`);
	return value;
}

async function expectAttached(page: Page, bubbleTestId: string, anchorTestId: string, containerTestId?: string) {
	const bubble = page.locator(`[data-testid="${bubbleTestId}"]:visible`);
	const anchor = page.locator(`[data-testid="${anchorTestId}"]:visible`);
	await expect(bubble).toBeVisible();
	await expect
		.poll(async () => {
			const bubbleBox = await bubble.boundingBox();
			const anchorBox = await anchor.boundingBox();
			if (!bubbleBox || !anchorBox) return `missing box`;
			const anchorCenter = anchorBox.x + anchorBox.width / 2;
			const withinX = anchorCenter > bubbleBox.x - 28 && anchorCenter < bubbleBox.x + bubbleBox.width + 28;
			const gapAbove = anchorBox.y - (bubbleBox.y + bubbleBox.height);
			const gapBelow = bubbleBox.y - (anchorBox.y + anchorBox.height);
			const attached = (gapAbove >= -16 && gapAbove <= 40) || (gapBelow >= -16 && gapBelow <= 40);
			const viewport = page.viewportSize();
			const inViewport =
				!!viewport &&
				bubbleBox.y >= -1 &&
				bubbleBox.x >= -1 &&
				bubbleBox.y + bubbleBox.height <= viewport.height + 1 &&
				bubbleBox.x + bubbleBox.width <= viewport.width + 1;
			let inContainer = true;
			if (containerTestId) {
				const container = await page.getByTestId(containerTestId).boundingBox();
				inContainer =
					!!container &&
					bubbleBox.y >= container.y - 4 &&
					bubbleBox.y + bubbleBox.height <= container.y + container.height + 4 &&
					bubbleBox.x >= container.x - 4 &&
					bubbleBox.x + bubbleBox.width <= container.x + container.width + 4;
			}
			if (withinX && attached && inViewport && inContainer) return `ok`;
			return JSON.stringify({ withinX, attached, inViewport, inContainer, gapAbove, gapBelow, bubbleBox, anchorBox });
		})
		.toBe(`ok`);
}
