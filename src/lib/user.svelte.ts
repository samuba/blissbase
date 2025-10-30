class User {
    id = $state<string | undefined>(undefined);
    isAdmin = $state(false);

    logout() {
        this.id = undefined;
    }
}

export const user = new User();