import { v7 as uuidv7 } from "uuid";

/** Time-ordered UUIDv7. Used for every primary key in the system. */
export function newId(): string {
  return uuidv7();
}
