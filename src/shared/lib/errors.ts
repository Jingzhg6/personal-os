/**
 * Expected business-rule failures (not bugs). Thrown by module services, translated by the
 * tRPC layer into an HTTP-ish code plus a stable `code` the UI maps to an i18n message
 * (`errors.<code>`).
 */
export type DomainErrorKind = "not_found" | "conflict" | "invalid";

export class DomainError extends Error {
  constructor(
    readonly kind: DomainErrorKind,
    /** Stable identifier, e.g. "task.not_found". Used as i18n key under `errors`. */
    readonly code: string,
  ) {
    super(code);
    this.name = "DomainError";
  }
}
