class User {
    id = $state<string | undefined>(undefined);
    isAdmin = $state(false);
}

export const user = new User();