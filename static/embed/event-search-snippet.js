/**
 * Embeddable breathwork event search. Events come from Blissbase.
 *
 * <script src="https://blissbase.app/embed/event-search-snippet.js" location-id="196" initial-limit="2" async></script>
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
	let submitEl = null;

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
		const root = document.createElement(`div`);
		root.className = `bw-embed`;
		root.dataset.testid = `breathwork-embed`;
		const style = document.createElement(`style`);
		style.textContent = widgetCss();
		root.append(style);

		const inner = el(`div`, `bw-inner`);
		const form = document.createElement(`form`);
		form.className = `bw-form`;

		if (!fixedLocationId) {
			form.append(citySelect());
		}
		form.append(datePicker());
		const submit = el(`button`, `bw-submit`);
		submit.type = `submit`;
		submit.dataset.testid = `breathwork-embed-search`;
		submit.textContent = `Suchen`;
		submitEl = submit;
		form.append(submit);
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
		target.replaceChildren(root);

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
			events = null;
			cursor = null;
			paintResults();
		});
		return select;
	}

	function datePicker() {
		const wrap = el(`div`, `bw-date-wrap`);
		const button = el(`button`, `bw-date`);
		button.type = `button`;
		button.dataset.testid = `breathwork-embed-date`;
		const popover = el(`div`, `bw-popover`);
		popover.hidden = true;
		let visibleMonth = new Date(range.start.getFullYear(), range.start.getMonth(), 1);
		let pickingEnd = false;

		function paintButton() {
			button.textContent = formatRangeLabel(range.start, range.end);
		}

		function paintCalendar() {
			popover.replaceChildren();
			const nav = el(`div`, `bw-cal-nav`);
			nav.append(navButton(`‹`, -1), el(`div`, `bw-cal-gap`), navButton(`›`, 1));
			const months = el(`div`, `bw-months`);
			const count = window.matchMedia(`(max-width: 767px)`).matches ? 1 : 2;
			for (let index = 0; index < count; index += 1) {
				months.append(monthView(addMonths(visibleMonth, index)));
			}
			popover.append(nav, months);
		}

		function navButton(label, delta) {
			const control = el(`button`, `bw-cal-nav-btn`);
			control.type = `button`;
			control.textContent = label;
			control.addEventListener(`click`, () => {
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
			for (let index = 0; index < lead; index += 1) grid.append(el(`div`, `bw-day bw-day-empty`));
			for (let day = 1; day <= days; day += 1) {
				const date = new Date(monthDate.getFullYear(), monthDate.getMonth(), day);
				const cell = el(`button`, dayClass(date));
				cell.type = `button`;
				cell.textContent = String(day);
				cell.addEventListener(`click`, () => {
					if (!pickingEnd) {
						range.start = date;
						range.end = date;
						pickingEnd = true;
					} else {
						range.end = date;
						if (range.end < range.start) {
							const swap = range.start;
							range.start = range.end;
							range.end = swap;
						}
						pickingEnd = false;
						popover.hidden = true;
					}
					paintButton();
					paintCalendar();
				});
				grid.append(cell);
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
			if (!wrap.contains(event.target)) popover.hidden = true;
		});
		paintButton();
		wrap.append(button, popover);
		return wrap;
	}

	function dayClass(date) {
		const key = dayKey(date);
		const startKey = dayKey(range.start);
		const endKey = dayKey(range.end);
		const classes = [`bw-day`];
		if (key === startKey || key === endKey) classes.push(`bw-day-end`);
		else if (date > range.start && date < range.end) classes.push(`bw-day-in`);
		if (key === dayKey(new Date())) classes.push(`bw-day-today`);
		return classes.join(` `);
	}

	async function runSearch({ append }) {
		if (loading || !chosenLocationId) return;
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
			cursor = data?.nextCursor ?? null;
			events = append && events ? events.concat(next) : next;
		} catch (error) {
			console.error(error);
			if (append) cursor = null;
			else events = [];
		} finally {
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
		if (submitEl) submitEl.disabled = loading;
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
		} else if (!initialLimit && cursor && events?.length) {
			const sentinel = el(`div`, `bw-sentinel`);
			results.append(sentinel);
			observer = new IntersectionObserver((entries) => {
				if (!entries.some((entry) => entry.isIntersecting)) return;
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
		if (script?.src) return new URL(API_PATH, script.src).href;
		return new URL(API_PATH, window.location.href).href;
	}

	function ensureFonts() {
		if (document.querySelector(`link[data-bw-fonts]`)) return;
		const link = document.createElement(`link`);
		link.rel = `stylesheet`;
		link.dataset.bwFonts = `true`;
		link.href = `https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500&family=DM+Serif+Display&display=swap`;
		document.head.append(link);
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
.bw-embed{display:flex;justify-content:center;padding:0 1rem 1.5rem;color:#1f1f1f;font-family:"DM Sans",Arial,sans-serif}
.bw-embed *{box-sizing:border-box}
.bw-inner{display:flex;width:100%;max-width:56rem;flex-direction:column;gap:1.5rem}
.bw-form{display:flex;flex-direction:column;justify-content:center;gap:1rem}
.bw-city,.bw-date,.bw-submit{height:2.5rem;border-radius:0.375rem;font:500 1rem/1 "DM Sans",Arial,sans-serif}
.bw-city,.bw-date{border:1px solid #e4e4e7;background:#fff;color:#18181b}
.bw-city{width:100%;padding:0 0.75rem}
.bw-date{display:flex;align-items:center;padding:0 0.75rem;cursor:pointer;white-space:nowrap}
.bw-submit{border:0;background:#92b28d;color:#fff;padding:0 1rem;cursor:pointer}
.bw-submit:disabled{cursor:default;opacity:0.6}
.bw-date-wrap{position:relative}
.bw-popover{position:absolute;z-index:20;top:calc(100% + 0.25rem);left:0;padding:0.75rem;border:1px solid #e4e4e7;border-radius:0.5rem;background:#fff;box-shadow:0 12px 30px rgba(0,0,0,0.12)}
.bw-cal-nav{display:flex;justify-content:space-between;margin-bottom:0.5rem}
.bw-cal-nav-btn{border:0;background:transparent;font-size:1.25rem;cursor:pointer;color:#3f3f46}
.bw-months{display:flex;gap:1rem}
.bw-month-title{margin-bottom:0.5rem;text-align:center;font-weight:500}
.bw-grid{display:grid;grid-template-columns:repeat(7,1.9rem);gap:0.15rem}
.bw-weekday{text-align:center;font-size:0.75rem;color:#71717a}
.bw-day{height:1.9rem;border:0;border-radius:0.375rem;background:transparent;cursor:pointer}
.bw-day-in{background:#d6e1d4}
.bw-day-end{background:#92b28d;color:#fff}
.bw-day-today{outline:1px solid #92b28d}
.bw-day-empty{height:1.9rem}
.bw-links{display:flex;justify-content:center;gap:1.5rem;margin-top:0.5rem;font-size:0.875rem}
.bw-add{color:#92b28d;text-decoration:none}
.bw-add:hover,.bw-powered:hover{text-decoration:underline}
.bw-powered{color:#d4d4d8;text-decoration:none}
.bw-columns{display:flex;gap:1.5rem}
.bw-column{display:flex;flex:1;min-width:0;flex-direction:column;gap:1.5rem}
.bw-card-link{color:inherit;text-decoration:none}
.bw-card{display:flex;min-width:0;flex-direction:column;overflow:hidden;border-radius:0.375rem;background:#d6e1d4;box-shadow:0 1px 3px rgba(0,0,0,0.12);cursor:pointer;transition:transform 0.15s ease,box-shadow 0.15s ease}
.bw-card:hover{transform:scale(1.03);box-shadow:0 10px 20px rgba(0,0,0,0.12)}
.bw-media{min-height:7rem;background:#d6e1d4}
.bw-image{display:block;width:100%;min-height:12rem;max-height:90dvw;object-fit:cover;object-position:center;border-radius:0.375rem 0.375rem 0 0}
.bw-card-body{display:flex;flex-direction:column;gap:0.5rem;padding:1.5rem}
.bw-title{margin:0;font-family:"DM Serif Display",Georgia,serif;font-size:1.4rem;font-weight:400}
.bw-time{font-size:1.125rem;color:rgb(79,79,79)}
.bw-venue{display:flex;gap:0.5rem;font-size:1.125rem;line-height:1.5rem;color:rgb(102,125,96)}
.bw-pin{margin-top:0.2rem;flex:none}
.bw-empty{padding:1rem 0;text-align:center;font-size:1.125rem}
.bw-loading,.bw-more{display:flex;justify-content:center;align-items:center;padding-top:1.5rem}
.bw-spinner{width:2rem;height:2rem;margin-right:0.5rem;border:3px solid rgb(102,125,96);border-right-color:transparent;border-radius:999px;animation:bw-spin 0.8s linear infinite}
@keyframes bw-spin{to{transform:rotate(360deg)}}
@media(min-width:768px){
.bw-form{flex-direction:row;align-items:center}
.bw-city{max-width:12rem}
}`;
	}

	mountWhenReady();
})();
