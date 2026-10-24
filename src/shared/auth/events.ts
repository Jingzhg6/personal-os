declare module "../events/types" {
  interface DomainEventMap {
    /** A new account was created. Modules use it to provision per-user defaults. */
    "user.registered": { email: string; name: string };
  }
}

export {};
