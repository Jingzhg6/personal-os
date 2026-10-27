declare module "@/shared/events/types" {
  interface DomainEventMap {
    /**
     * A balance batch was saved (M10: consumed by automation rules). Deliberately carries counts
     * only — no balances, rates or account names.
     */
    "finance.snapshot_saved": {
      valuationDate: string;
      entryCount: number;
      /** Entries saved without a rate to the base currency (excluded from totals). */
      unconvertedCount: number;
      /** At least one entry corrected an existing snapshot. */
      corrected: boolean;
    };
  }
}

export {};
