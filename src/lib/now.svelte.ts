class Now {
	value = $state(new Date());

	constructor() {
		setInterval(() => {
			this.value = new Date();
		}, 1000);
	}
}

export const now = new Now();
