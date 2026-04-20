
// counts down from a given number of seconds while updating the secondsLeft property reactively
export class ReactiveCountdown {
    private timer: NodeJS.Timeout | undefined;

    secondsLeft = $state(0);
    isActive = $state(false);

    constructor(seconds: number) {
        this.secondsLeft = seconds;
    }

    start() {
        if (this.timer) clearInterval(this.timer);
        this.isActive = true
        this.timer = setInterval(() => {
            if (this.secondsLeft > 0) {
              this.secondsLeft -= 1;
            } else {
              this.isActive = false;
              clearInterval(this.timer);
            }
        }, 1000);
    }
}
