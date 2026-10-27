import { users } from "@/shared/auth/schema";
import type { DbExecutor } from "@/shared/db/types";
import { newId } from "@/shared/lib/id";

export async function createUser(
  db: DbExecutor,
  overrides: Partial<typeof users.$inferInsert> = {},
) {
  const id = overrides.id ?? newId();
  const [user] = await db
    .insert(users)
    .values({ id, name: "测试用户", email: `user-${id}@example.test`, ...overrides })
    .returning();
  return user!;
}

/** A user with the default areas, task statuses and development attributes, as after registration. */
export async function createSeededUser(db: DbExecutor) {
  const { seedDefaultAreas } = await import("@/modules/areas/server");
  const { seedDefaultStatuses } = await import("@/modules/tasks/server");
  const { seedDevelopmentAttributes } = await import("@/modules/character/server");
  const user = await createUser(db);
  await seedDefaultAreas(db, user.id);
  await seedDefaultStatuses(db, user.id);
  await seedDevelopmentAttributes(db, user.id);
  return user;
}
