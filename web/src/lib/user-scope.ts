const ACTIVE_USER_SCOPE_KEY = "yingce:active-user-scope";
const GUEST_SCOPE = "guest";
let userScopedPersistenceSuppressionDepth = 0;
let activeUserScope: string | undefined;

export function withUserScopedPersistenceSuppressed<T>(operation: () => T) {
    userScopedPersistenceSuppressionDepth += 1;
    try {
        return operation();
    } finally {
        userScopedPersistenceSuppressionDepth -= 1;
    }
}

export function isUserScopedPersistenceSuppressed() {
    return userScopedPersistenceSuppressionDepth > 0;
}

export function getActiveUserScope() {
    if (typeof window === "undefined") return GUEST_SCOPE;
    // Keep this tab's mounted state bound to its identity until it is reloaded.
    return activeUserScope ?? window.localStorage.getItem(ACTIVE_USER_SCOPE_KEY) ?? GUEST_SCOPE;
}

export function setActiveUserScope(userId?: string | null) {
    if (typeof window === "undefined") return;
    activeUserScope = userId || GUEST_SCOPE;
    window.localStorage.setItem(ACTIVE_USER_SCOPE_KEY, userId || GUEST_SCOPE);
}

export function scopedStorageKey(name: string, scope = getActiveUserScope()) {
    return `${name}:user:${scope}`;
}

export const scopedLocalStorage = {
    getItem: (name: string) => {
        if (typeof window === "undefined") return null;
        return window.localStorage.getItem(scopedStorageKey(name));
    },
    setItem: (name: string, value: string) => {
        if (typeof window === "undefined") return;
        if (isUserScopedPersistenceSuppressed()) return;
        window.localStorage.setItem(scopedStorageKey(name), value);
    },
    removeItem: (name: string) => {
        if (typeof window === "undefined") return;
        if (isUserScopedPersistenceSuppressed()) return;
        window.localStorage.removeItem(scopedStorageKey(name));
    },
};
