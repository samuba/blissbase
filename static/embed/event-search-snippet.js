/**
 * Embeddable breathwork event search. Events come from Blissbase.
 *
 * <script src="https://www.blissbase.app/embed/event-search-snippet.js" location-id="196" initial-limit="2" async></script>
 * <div id="app"></div>
 *
 * Omit location-id to show the city select. initial-limit loads that many events on startup.
 * City ids match the previous snippet: 195 Berlin, 196 Hamburg, 197 München, 198 Köln,
 * 199 Frankfurt, 200 Hannover, 201 Stuttgart, 202 Düsseldorf, 203 Wien, 204 Graz, 206 Zürich, 205 Bern.
 */
(function () {
	const script = document.currentScript;
	const API_PATH = `/api/embed/breathwork.global`;
	const CITIES = [
		{ id: `195`, name: `Berlin`, country: `Deutschland` },
		{ id: `196`, name: `Hamburg`, country: `Deutschland` },
		{ id: `197`, name: `München`, country: `Deutschland` },
		{ id: `198`, name: `Köln`, country: `Deutschland` },
		{ id: `199`, name: `Frankfurt`, country: `Deutschland` },
		{ id: `200`, name: `Hannover`, country: `Deutschland` },
		{ id: `201`, name: `Stuttgart`, country: `Deutschland` },
		{ id: `202`, name: `Düsseldorf`, country: `Deutschland` },
		{ id: `203`, name: `Wien`, country: `Österreich` },
		{ id: `204`, name: `Graz`, country: `Österreich` },
		{ id: `206`, name: `Zürich`, country: `Schweiz` },
		{ id: `205`, name: `Bern`, country: `Schweiz` },
	];

	const fixedLocationId = script?.getAttribute(`location-id`) ?? ``;
	let chosenLocationId = fixedLocationId;
	let initialLimit = parseInitialLimit(script?.getAttribute(`initial-limit`));
	let events = null;
	let cursor = null;
	let loading = false;
	let mounted = false;
	let observer = null;
	let resultsEl = null;
	let searchId = 0;
	let pickingEnd = false;
	let pendingStart = null;

	const range = {
		start: startOfDay(new Date()),
		end: addDays(startOfDay(new Date()), 40),
	};

	function mountWhenReady() {
		if (mounted) return;
		const existing = document.getElementById(`app`);
		if (existing) {
			mounted = true;
			mount(existing);
			return;
		}
		if (document.readyState === `loading`) {
			document.addEventListener(`DOMContentLoaded`, mountWhenReady, { once: true });
			return;
		}
		const created = document.createElement(`div`);
		created.id = `app`;
		const parent = script?.parentNode ?? document.body;
		parent.insertBefore(created, script?.nextSibling ?? null);
		mounted = true;
		mount(created);
	}

	function mount(target) {
		ensureFonts();
		const host = document.createElement(`div`);
		host.style.cssText = `display:block;width:100%`;
		const shadow = host.attachShadow({ mode: `open` });
		const style = document.createElement(`style`);
		style.textContent = widgetCss();
		const root = document.createElement(`div`);
		root.className = `bw-embed`;
		root.dataset.testid = `breathwork-embed`;
		shadow.append(style, root);

		const inner = el(`div`, `bw-inner`);
		const form = document.createElement(`form`);
		form.className = `bw-form`;

		if (!fixedLocationId) {
			form.append(citySelect());
		}
		form.append(datePicker());
		form.addEventListener(`submit`, (event) => {
			event.preventDefault();
			initialLimit = null;
			runSearch({ append: false });
		});

		const links = el(`div`, `bw-links`);
		links.append(anchor(`#event-eintragen`, `Events hinzufügen`, `bw-add`));
		const powered = anchor(`https://blissbase.app`, `powered by Blissbase`, `bw-powered`);
		powered.target = `_blank`;
		powered.rel = `noopener noreferrer`;
		links.append(powered);

		const results = el(`div`, `bw-results`);
		results.dataset.testid = `breathwork-embed-results`;
		resultsEl = results;

		inner.append(el(`div`, `bw-form-block`, form, links), results);
		root.append(inner);
		target.replaceChildren(host);

		const mobileQuery = window.matchMedia(`(max-width: 767px)`);
		mobileQuery.addEventListener(`change`, paintResults);
		paintResults();

		if (initialLimit != null && chosenLocationId) {
			runSearch({ append: false });
		}
	}

	function citySelect() {
		const select = document.createElement(`select`);
		select.className = `bw-city`;
		select.required = true;
		select.dataset.testid = `breathwork-embed-city`;
		const placeholder = document.createElement(`option`);
		placeholder.disabled = true;
		placeholder.selected = !chosenLocationId;
		placeholder.value = ``;
		placeholder.textContent = `Stadt auswählen`;
		select.append(placeholder);

		let country = ``;
		let group = null;
		for (const city of CITIES) {
			if (city.country !== country) {
				country = city.country;
				group = document.createElement(`optgroup`);
				group.label = city.country;
				select.append(group);
			}
			const option = document.createElement(`option`);
			option.value = city.id;
			option.textContent = city.name;
			if (city.id === chosenLocationId) option.selected = true;
			group?.append(option);
		}

		select.addEventListener(`change`, () => {
			chosenLocationId = select.value;
			initialLimit = null;
			runSearch({ append: false });
		});
		return select;
	}

	function datePicker() {
		const wrap = el(`div`, `bw-date-wrap`);
		const button = el(`button`, `bw-date`);
		button.type = `button`;
		button.dataset.testid = `breathwork-embed-date`;
		const dateLabel = el(`span`, `bw-date-label`);
		button.append(calendarIcon(), dateLabel);
		const popover = el(`div`, `bw-popover`);
		popover.hidden = true;
		let visibleMonth = new Date(range.start.getFullYear(), range.start.getMonth(), 1);
		let hoverDate = null;

		function paintButton() {
			const start = pickingEnd && pendingStart ? pendingStart : range.start;
			const end = pickingEnd && pendingStart ? pendingStart : range.end;
			dateLabel.textContent = formatRangeLabel(start, end);
		}

		function paintCalendar() {
			popover.replaceChildren();
			const nav = el(`div`, `bw-cal-nav`);
			nav.append(navButton(-1), navButton(1));
			const months = el(`div`, `bw-months`);
			const count = window.matchMedia(`(max-width: 767px)`).matches ? 1 : 2;
			for (let index = 0; index < count; index += 1) {
				months.append(monthView(addMonths(visibleMonth, index)));
			}
			popover.append(nav, months);
		}

		function navButton(delta) {
			const control = el(`button`, `bw-cal-nav-btn`);
			control.type = `button`;
			control.setAttribute(`aria-label`, delta < 0 ? `Vorheriger Monat` : `Nächster Monat`);
			control.append(chevronIcon(delta));
			control.addEventListener(`click`, () => {
				hoverDate = null;
				visibleMonth = addMonths(visibleMonth, delta);
				paintCalendar();
			});
			return control;
		}

		function monthView(monthDate) {
			const month = el(`div`, `bw-month`);
			const title = el(`div`, `bw-month-title`);
			title.textContent = new Intl.DateTimeFormat(`de-DE`, { month: `long`, year: `numeric` }).format(monthDate);
			const grid = el(`div`, `bw-grid`);
			for (const weekday of [`Mo`, `Di`, `Mi`, `Do`, `Fr`, `Sa`, `So`]) {
				const cell = el(`div`, `bw-weekday`);
				cell.textContent = weekday;
				grid.append(cell);
			}
			const first = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
			const lead = (first.getDay() + 6) % 7;
			const days = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).getDate();
			for (let index = 0; index < lead; index += 1) grid.append(el(`div`, `bw-slot`));
			for (let day = 1; day <= days; day += 1) {
				const date = new Date(monthDate.getFullYear(), monthDate.getMonth(), day);
				grid.append(dayCell(date));
			}
			month.append(title, grid);
			return month;
		}

		button.addEventListener(`click`, () => {
			popover.hidden = !popover.hidden;
			if (!popover.hidden) {
				visibleMonth = new Date(range.start.getFullYear(), range.start.getMonth(), 1);
				paintCalendar();
			}
		});
		document.addEventListener(`click`, (event) => {
			if (event.composedPath().includes(wrap)) return;
			popover.hidden = true;
			hoverDate = null;
			if (!pickingEnd) return;
			pickingEnd = false;
			pendingStart = null;
			paintButton();
		});
		popover.addEventListener(`pointerover`, (event) => {
			if (!pickingEnd || !pendingStart) return;
			const button = event.target.closest?.(`button.bw-day`);
			if (!button) return;
			const next = dateFromKey(button.parentElement.dataset.day);
			if (hoverDate && dayKey(hoverDate) === dayKey(next)) return;
			hoverDate = next;
			paintRange();
		});
		popover.addEventListener(`pointerleave`, () => {
			if (!hoverDate) return;
			hoverDate = null;
			paintRange();
		});

		function boundsForPaint() {
			if (pickingEnd && pendingStart) {
				const end = hoverDate || pendingStart;
				if (end < pendingStart) return { start: end, end: pendingStart, preview: Boolean(hoverDate) };
				return { start: pendingStart, end, preview: Boolean(hoverDate) };
			}
			return { start: range.start, end: range.end, preview: false };
		}

		function paintRange() {
			for (const slot of popover.querySelectorAll(`[data-day]`)) syncDay(slot);
		}

		function syncDay(slot) {
			const date = dateFromKey(slot.dataset.day);
			const bounds = boundsForPaint();
			const key = dayKey(date);
			const isStart = key === dayKey(bounds.start);
			const isEnd = key === dayKey(bounds.end);
			const isIn = !isStart && !isEnd && date > bounds.start && date < bounds.end;
			const weekday = (date.getDay() + 6) % 7;
			const prev = addDays(date, -1);
			const next = addDays(date, 1);
			const joinLeft = weekday !== 0 && sameMonth(date, prev) && isSelectedDay(prev, bounds);
			const joinRight = weekday !== 6 && sameMonth(date, next) && isSelectedDay(next, bounds);
			const marked = isIn || isStart || isEnd;
			const slotClasses = [`bw-slot`];
			if (isIn) slotClasses.push(bounds.preview ? `bw-slot-preview` : `bw-slot-in`);
			if (isStart) slotClasses.push(`bw-slot-start`);
			if (isEnd) slotClasses.push(`bw-slot-end`);
			if (marked && joinLeft) slotClasses.push(`bw-slot-join-left`);
			if (marked && joinRight) slotClasses.push(`bw-slot-join-right`);
			slot.className = slotClasses.join(` `);

			const buttonClasses = [`bw-day`];
			if (isStart || isEnd) buttonClasses.push(`bw-day-end`);
			else if (isIn) buttonClasses.push(`bw-day-in`);
			if (key === dayKey(new Date())) buttonClasses.push(`bw-day-today`);
			slot.querySelector(`button`).className = buttonClasses.join(` `);
		}

		function dayCell(date) {
			const slot = el(`div`, `bw-slot`);
			slot.dataset.day = dayKey(date);
			const cell = el(`button`, `bw-day`);
			cell.type = `button`;
			cell.textContent = String(date.getDate());
			cell.addEventListener(`click`, () => {
				if (!pickingEnd) {
					pendingStart = date;
					pickingEnd = true;
					hoverDate = null;
					paintButton();
					paintCalendar();
					return;
				}
				range.start = pendingStart;
				range.end = date;
				if (range.end < range.start) {
					const swap = range.start;
					range.start = range.end;
					range.end = swap;
				}
				pickingEnd = false;
				pendingStart = null;
				hoverDate = null;
				popover.hidden = true;
				initialLimit = null;
				paintButton();
				runSearch({ append: false });
			});
			slot.append(cell);
			syncDay(slot);
			return slot;
		}

		paintButton();
		wrap.append(button, popover);
		return wrap;
	}

	function dateFromKey(key) {
		const [year, month, day] = key.split(`-`).map(Number);
		return new Date(year, month, day);
	}

	function sameMonth(a, b) {
		return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
	}

	function isSelectedDay(date, bounds) {
		const key = dayKey(date);
		if (key === dayKey(bounds.start) || key === dayKey(bounds.end)) return true;
		return date > bounds.start && date < bounds.end;
	}

	function chevronIcon(delta) {
		const svg = document.createElementNS(`http://www.w3.org/2000/svg`, `svg`);
		svg.setAttribute(`viewBox`, `0 0 24 24`);
		svg.setAttribute(`fill`, `none`);
		svg.setAttribute(`stroke`, `currentColor`);
		svg.setAttribute(`stroke-width`, `2.5`);
		svg.setAttribute(`stroke-linecap`, `round`);
		svg.setAttribute(`stroke-linejoin`, `round`);
		svg.setAttribute(`aria-hidden`, `true`);
		const path = document.createElementNS(`http://www.w3.org/2000/svg`, `path`);
		path.setAttribute(`d`, delta < 0 ? `M14.5 6.5 9 12l5.5 5.5` : `M9.5 6.5 15 12l-5.5 5.5`);
		svg.append(path);
		return svg;
	}

	async function runSearch({ append }) {
		if (!chosenLocationId) return;
		if (append && loading) return;
		const id = ++searchId;
		if (!append) {
			events = null;
			cursor = null;
		}
		loading = true;
		paintResults();
		try {
			const response = await fetch(apiUrl(), {
				method: `POST`,
				headers: { "Content-Type": `application/json` },
				body: JSON.stringify(requestBody()),
			});
			if (id !== searchId) return;
			if (!response.ok) throw new Error(`breathwork embed search failed`);
			const data = await response.json();
			const batch = Array.isArray(data?.results) ? data.results : [];
			const next = [];
			for (const event of batch) {
				try {
					next.push(normalizeEvent(event));
				} catch (error) {
					console.error(error);
				}
			}
			cursor = next.length ? (data?.nextCursor ?? null) : null;
			events = append && events ? events.concat(next) : next;
		} catch (error) {
			if (id !== searchId) return;
			console.error(error);
			if (append) cursor = null;
			else events = [];
		} finally {
			if (id !== searchId) return;
			loading = false;
			paintResults();
		}
	}

	function requestBody() {
		const body = {
			limit: initialLimit != null ? initialLimit : 8,
			start: isoDate(range.start),
			end: isoDate(range.end),
			searchTerm: `breathwork`,
			cursor,
		};
		const numericId = Number(chosenLocationId);
		if (Number.isInteger(numericId)) body.locationId = numericId;
		else body.city = chosenLocationId;
		return body;
	}

	function paintResults() {
		const results = resultsEl;
		if (!results) return;
		observer?.disconnect();
		results.replaceChildren();

		if (events?.length) {
			const mobile = window.matchMedia(`(max-width: 767px)`).matches;
			const left = el(`div`, `bw-column`);
			const right = el(`div`, `bw-column`);
			events.forEach((event, index) => {
				let card = null;
				try {
					card = eventCard(event);
				} catch (error) {
					console.error(error);
					return;
				}
				if (mobile || index % 2 === 0) left.append(card);
				else right.append(card);
			});
			const columns = el(`div`, `bw-columns`);
			columns.append(left);
			if (!mobile) columns.append(right);
			results.append(columns);
		} else if (events && !loading) {
			const empty = el(`div`, `bw-empty`);
			empty.dataset.testid = `breathwork-embed-empty`;
			empty.textContent = `Keine Events gefunden`;
			results.append(empty);
		}

		if (loading) {
			const status = el(`div`, `bw-loading`);
			status.dataset.testid = `breathwork-embed-loading`;
			status.append(el(`span`, `bw-spinner`), document.createTextNode(`Lade`));
			results.append(status);
		}

		if (initialLimit != null && events?.length && cursor) {
			const moreWrap = el(`div`, `bw-more`);
			const more = el(`button`, `bw-submit`);
			more.type = `button`;
			more.dataset.testid = `breathwork-embed-more`;
			more.textContent = `Mehr Events anzeigen`;
			more.addEventListener(`click`, () => {
				initialLimit = null;
				runSearch({ append: true });
			});
			moreWrap.append(more);
			results.append(moreWrap);
		} else if (!loading && !initialLimit && cursor && events?.length) {
			const sentinel = el(`div`, `bw-sentinel`);
			results.append(sentinel);
			let armed = false;
			observer = new IntersectionObserver((entries) => {
				const visible = entries.some((entry) => entry.isIntersecting);
				if (!visible) {
					armed = true;
					return;
				}
				if (!armed || loading) return;
				observer?.disconnect();
				runSearch({ append: true });
			});
			observer.observe(sentinel);
		}
	}

	function eventCard(event) {
		const link = document.createElement(`a`);
		link.className = `bw-card-link`;
		link.target = `_blank`;
		link.rel = `noopener noreferrer`;
		link.href = event.url;
		link.dataset.testid = `breathwork-embed-event`;

		const article = el(`article`, `bw-card`);
		const media = el(`div`, `bw-media`);
		if (event.imageUrl) {
			const image = document.createElement(`img`);
			image.className = `bw-image`;
			image.src = event.imageUrl;
			image.alt = event.name;
			media.append(image);
		}
		const body = el(`div`, `bw-card-body`);
		const title = el(`h4`, `bw-title`);
		title.textContent = event.name;
		const time = el(`time`, `bw-time`);
		time.textContent = formatEventWhen(event.startDate, event.endDate);
		const venue = el(`div`, `bw-venue`);
		venue.append(pinIcon(), el(`div`, `bw-venue-text`));
		venue.lastChild.textContent = event.venue;
		body.append(title, time, venue);
		article.append(media, body);
		link.append(article);
		return link;
	}

	function normalizeEvent(event) {
		const start = new Date(event?.startDate);
		if (!event?.name || !event?.url || Number.isNaN(start.getTime())) {
			throw new Error(`breathwork embed skipped a result`);
		}
		return event;
	}

	function formatEventWhen(startValue, endValue) {
		const start = new Date(startValue);
		const end = endValue ? new Date(endValue) : null;
		const time = new Intl.DateTimeFormat(`de-DE`, { timeStyle: `short` });
		const dateTime = new Intl.DateTimeFormat(`de-DE`, { dateStyle: `short`, timeStyle: `short` });
		const todayKey = dayKey(new Date());
		const tomorrow = new Date();
		tomorrow.setDate(tomorrow.getDate() + 1);
		const tomorrowKey = dayKey(tomorrow);
		const startKey = dayKey(start);
		let startLabel = dateTime.format(start);
		if (startKey === todayKey) startLabel = `Heute ${time.format(start)}`;
		else if (startKey === tomorrowKey) startLabel = `Morgen ${time.format(start)}`;
		if (!end || Number.isNaN(end.getTime())) return startLabel;
		const endKey = dayKey(end);
		let endLabel = dateTime.format(end);
		if (endKey === startKey || endKey === todayKey || (endKey === tomorrowKey && startKey === tomorrowKey)) {
			endLabel = time.format(end);
		} else if (endKey === tomorrowKey) {
			endLabel = `Morgen ${time.format(end)}`;
		}
		return `${startLabel} – ${endLabel}`;
	}

	function formatRangeLabel(start, end) {
		const medium = new Intl.DateTimeFormat(`de-DE`, { dateStyle: `medium` });
		if (!start) return `Pick a date`;
		if (!end || dayKey(start) === dayKey(end)) return medium.format(start);
		return `${medium.format(start)} - ${medium.format(end)}`;
	}

	function apiUrl() {
		const configured = script?.getAttribute(`api-origin`);
		if (configured) return new URL(API_PATH, configured).href;
		const base = script?.src ? new URL(script.src, window.location.href) : new URL(window.location.href);
		// blissbase.app redirects to www without CORS headers, so the browser drops the search.
		if (base.hostname === `blissbase.app`) base.hostname = `www.blissbase.app`;
		return new URL(API_PATH, base).href;
	}

	function ensureFonts() {
		if (document.querySelector(`link[data-bw-fonts]`)) return;
		const link = document.createElement(`link`);
		link.rel = `stylesheet`;
		link.dataset.bwFonts = `true`;
		link.href = `https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500&family=DM+Serif+Display&display=swap`;
		document.head.append(link);
	}

	function calendarIcon() {
		const svg = document.createElementNS(`http://www.w3.org/2000/svg`, `svg`);
		svg.setAttribute(`viewBox`, `0 0 24 24`);
		svg.setAttribute(`fill`, `none`);
		svg.setAttribute(`stroke`, `currentColor`);
		svg.setAttribute(`stroke-width`, `2`);
		svg.setAttribute(`stroke-linecap`, `round`);
		svg.setAttribute(`stroke-linejoin`, `round`);
		svg.setAttribute(`aria-hidden`, `true`);
		svg.setAttribute(`class`, `bw-cal-icon`);
		for (const d of [`M8 2v4`, `M16 2v4`, `M3 10h18`]) {
			const path = document.createElementNS(`http://www.w3.org/2000/svg`, `path`);
			path.setAttribute(`d`, d);
			svg.append(path);
		}
		const rect = document.createElementNS(`http://www.w3.org/2000/svg`, `rect`);
		rect.setAttribute(`width`, `18`);
		rect.setAttribute(`height`, `18`);
		rect.setAttribute(`x`, `3`);
		rect.setAttribute(`y`, `4`);
		rect.setAttribute(`rx`, `2`);
		svg.append(rect);
		return svg;
	}

	function pinIcon() {
		const svg = document.createElementNS(`http://www.w3.org/2000/svg`, `svg`);
		svg.setAttribute(`viewBox`, `0 0 24 24`);
		svg.setAttribute(`width`, `16`);
		svg.setAttribute(`height`, `16`);
		svg.setAttribute(`fill`, `none`);
		svg.setAttribute(`stroke`, `currentColor`);
		svg.setAttribute(`stroke-width`, `2`);
		svg.setAttribute(`stroke-linecap`, `round`);
		svg.setAttribute(`stroke-linejoin`, `round`);
		const path = document.createElementNS(`http://www.w3.org/2000/svg`, `path`);
		path.setAttribute(`d`, `M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z`);
		const circle = document.createElementNS(`http://www.w3.org/2000/svg`, `circle`);
		circle.setAttribute(`cx`, `12`);
		circle.setAttribute(`cy`, `10`);
		circle.setAttribute(`r`, `3`);
		svg.append(path, circle);
		return el(`div`, `bw-pin`, svg);
	}

	function anchor(href, text, className) {
		const link = document.createElement(`a`);
		link.href = href;
		link.className = className;
		link.textContent = text;
		return link;
	}

	function el(tag, className, ...children) {
		const node = document.createElement(tag);
		if (className) node.className = className;
		node.append(...children);
		return node;
	}

	function parseInitialLimit(value) {
		if (value == null || value === ``) return null;
		const parsed = Number.parseInt(value, 10);
		if (!Number.isFinite(parsed) || parsed <= 0) return null;
		return parsed;
	}

	function startOfDay(date) {
		return new Date(date.getFullYear(), date.getMonth(), date.getDate());
	}

	function addDays(date, days) {
		const next = new Date(date);
		next.setDate(next.getDate() + days);
		return next;
	}

	function addMonths(date, count) {
		return new Date(date.getFullYear(), date.getMonth() + count, 1);
	}

	function isoDate(date) {
		const month = String(date.getMonth() + 1).padStart(2, `0`);
		const day = String(date.getDate()).padStart(2, `0`);
		return `${date.getFullYear()}-${month}-${day}`;
	}

	function dayKey(date) {
		return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
	}

	function widgetCss() {
		return `
.bw-embed{display:flex;justify-content:center;padding:0 1rem 1.5rem;color:#1f1f1f;font-family:"DM Sans",Arial,sans-serif;font-size:16px;line-height:1.5;text-align:left}
.bw-embed *,.bw-embed *::before,.bw-embed *::after{box-sizing:border-box}
.bw-embed button,.bw-embed select{margin:0;font:inherit;letter-spacing:normal;text-transform:none}
.bw-embed button{appearance:none;margin:0;border:0;background:transparent;padding:0;font:inherit;letter-spacing:normal;text-transform:none;cursor:pointer}
.bw-embed a{text-decoration:none}
.bw-embed h4,.bw-embed p{margin:0}
.bw-embed img{display:block;max-width:100%;border:0}
.bw-inner{display:flex;width:100%;max-width:56rem;flex-direction:column;gap:1.5rem}
.bw-form{display:flex;flex-direction:column;align-items:flex-start;justify-content:center;gap:1rem}
.bw-embed .bw-city,.bw-embed .bw-submit{height:2.5rem;border-radius:0.375rem;font:500 0.875rem/1 "DM Sans",Arial,sans-serif}
.bw-embed .bw-city{appearance:none;-webkit-appearance:none;width:100%;max-width:100%;border:1px solid #e4e4e7;background-color:#fff;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%233f3f46' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 0.7rem center;background-size:1.05rem 1.05rem;color:#18181b;padding:0 2.15rem 0 0.85rem;line-height:2.5rem;cursor:pointer}
.bw-embed .bw-city:hover{border-color:#d4d4d8}
.bw-embed .bw-date{display:inline-flex;align-items:center;gap:0.5rem;width:fit-content;max-width:100%;height:2.5rem;padding:0 1rem;border:1px solid #e4e4e7;border-radius:0.375rem;background:#fff;color:#18181b;font:500 0.875rem/1 "DM Sans",Arial,sans-serif;white-space:nowrap}
.bw-cal-icon{width:1rem;height:1rem;flex:none}
.bw-embed .bw-submit{display:inline-flex;align-items:center;justify-content:center;border:0;background:#92b28d;color:#fff;padding:0 1rem}
.bw-submit:disabled{cursor:default;opacity:0.6}
.bw-date-wrap{position:relative;width:fit-content;max-width:100%;flex:none}
.bw-popover{position:absolute;z-index:50;top:calc(100% + 0.25rem);left:0;max-width:calc(100vw - 2rem);padding:0.4rem 0.35rem 0.3rem;border:1px solid #e4e4e7;border-radius:0.5rem;background:#fff;box-shadow:0 12px 30px rgba(0,0,0,0.12)}
.bw-popover[hidden]{display:none}
.bw-cal-nav{position:absolute;z-index:2;top:0.15rem;left:0.05rem;right:0.05rem;display:flex;justify-content:space-between;pointer-events:none}
.bw-embed .bw-cal-nav-btn{pointer-events:auto;display:inline-flex;align-items:center;justify-content:center;width:2.5rem;height:2.5rem;border-radius:0.375rem;color:#3f3f46}
.bw-cal-nav-btn svg{width:1.7rem;height:1.7rem;display:block}
.bw-cal-nav-btn:hover{background:#f4f4f5}
.bw-months{display:flex;gap:0.75rem}
.bw-month-title{display:flex;align-items:center;justify-content:center;height:2rem;margin-bottom:0.1rem;text-align:center;font-weight:500;text-transform:capitalize}
.bw-grid{display:grid;grid-template-columns:repeat(7,2.55rem)}
.bw-weekday{display:flex;align-items:center;justify-content:center;height:1.7rem;font-size:0.8rem;color:#71717a}
.bw-slot{position:relative;display:flex;align-items:center;justify-content:center;height:2.7rem}
.bw-slot::before{content:"";position:absolute;top:0.32rem;bottom:0.32rem;background:#d6e1d4;display:none}
.bw-slot-in::before,.bw-slot-preview::before{display:block;left:0;right:0}
.bw-slot-preview::before{background:#e7f0e3}
.bw-slot-in.bw-slot-join-left::before,.bw-slot-preview.bw-slot-join-left::before{left:-1px}
.bw-slot-in.bw-slot-join-right::before,.bw-slot-preview.bw-slot-join-right::before{right:-1px}
.bw-slot-in:not(.bw-slot-join-left)::before,.bw-slot-preview:not(.bw-slot-join-left)::before{border-top-left-radius:999px;border-bottom-left-radius:999px}
.bw-slot-in:not(.bw-slot-join-right)::before,.bw-slot-preview:not(.bw-slot-join-right)::before{border-top-right-radius:999px;border-bottom-right-radius:999px}
.bw-slot-start.bw-slot-join-right::before{display:block;left:50%;right:-1px}
.bw-slot-end.bw-slot-join-left::before{display:block;left:-1px;right:50%}
.bw-slot-start.bw-slot-end::before{display:none}
.bw-embed .bw-day{position:relative;z-index:1;width:2.3rem;height:2.3rem;border-radius:0.45rem;background:transparent;color:#1f1f1f;font-size:0.95rem;font-weight:400}
.bw-embed .bw-day:hover{background:#f4f4f5}
.bw-embed .bw-day-in{background:transparent;border-radius:0}
.bw-embed .bw-day-in:hover{background:#c5d6c1;border-radius:999px}
.bw-slot-preview .bw-day-in:hover{background:#d5e6d0}
.bw-embed .bw-day-end,.bw-embed .bw-day-end:hover{border-radius:999px;background:#4f7348;color:#fff;font-weight:500}
.bw-day-today:not(.bw-day-end){box-shadow:inset 0 0 0 1px #92b28d}
.bw-links{display:flex;flex-wrap:wrap;justify-content:center;gap:1.5rem;margin-top:0.5rem;font-size:0.875rem}
.bw-embed .bw-add{color:#92b28d}
.bw-embed .bw-add:hover,.bw-embed .bw-powered:hover{text-decoration:underline}
.bw-embed .bw-powered{color:#d4d4d8}
.bw-columns{display:flex;gap:1.5rem;width:100%}
.bw-column{display:flex;flex:1;min-width:0;flex-direction:column;gap:1.5rem}
.bw-embed .bw-card-link{display:block;min-width:0;color:#1f1f1f}
.bw-card{display:flex;min-width:0;flex-direction:column;overflow:hidden;border-radius:0.375rem;background:#d6e1d4;box-shadow:0 1px 3px rgba(0,0,0,0.12);transition:transform 0.15s ease,box-shadow 0.15s ease}
.bw-card:hover{transform:scale(1.03);box-shadow:0 10px 20px rgba(0,0,0,0.12)}
.bw-media{min-height:7rem;background:#d6e1d4}
.bw-embed .bw-image{width:100%;height:12rem;max-height:90dvw;object-fit:cover;object-position:center;border-radius:0.375rem 0.375rem 0 0}
.bw-card-body{display:flex;flex-direction:column;gap:0.5rem;padding:1.5rem}
.bw-embed .bw-title{font-family:"DM Serif Display",Georgia,serif;font-size:1.4rem;font-weight:400;line-height:1.3}
.bw-time{font-size:1.125rem;line-height:1.75rem;color:rgb(79,79,79)}
.bw-venue{display:flex;gap:0.5rem;font-size:1.125rem;line-height:1.5rem;color:rgb(102,125,96)}
.bw-pin{margin-top:0.2rem;flex:none;color:rgb(102,125,96)}
.bw-pin svg{display:block}
.bw-empty{padding:1rem 0;text-align:center;font-size:1.125rem}
.bw-loading,.bw-more{display:flex;justify-content:center;align-items:center;padding-top:1.5rem}
.bw-spinner{width:2rem;height:2rem;margin-right:0.5rem;border:3px solid rgb(102,125,96);border-right-color:transparent;border-radius:999px;animation:bw-spin 0.8s linear infinite}
@keyframes bw-spin{to{transform:rotate(360deg)}}
@media(min-width:768px){
.bw-form{flex-direction:row;align-items:center}
.bw-embed .bw-city{width:12rem;flex:none}
}`;
	}

	mountWhenReady();
})();
