import { redirect } from "next/navigation";

// Development goals (M8) live in 成长; the sidebar's 目标 opens that section. A static route, so
// /projects/goals is not captured by /projects/[id].
export default function Page() {
  redirect("/development#goals");
}
