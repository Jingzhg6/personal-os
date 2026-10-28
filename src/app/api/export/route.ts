import { countRecords, exportFileName } from "@/modules/data-export/domain";
import { exportUserData } from "@/modules/data-export/server";
import { getSession } from "@/server/session";
import { getDb } from "@/shared/db/client";

/**
 * Personal data export (ADR 0025): the signed-in user's records as one JSON file. POST, so a
 * link, a prefetch or a cross-site page cannot start it (the session cookie is SameSite=Lax).
 * The file is built on request and sent only to the browser; nothing is stored or uploaded.
 */
export async function POST() {
  const session = await getSession();
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  try {
    const now = new Date();
    const document = await exportUserData(getDb(), session.user.id, now);
    return new Response(JSON.stringify(document, null, 2), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="${exportFileName(now, document.timeZone)}"`,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "x-export-records": String(countRecords(document.counts)),
      },
    });
  } catch (error) {
    // The cause stays in the server log (name only: no user data); the client shows a retry.
    console.error("data export failed", (error as Error).name);
    return Response.json({ error: "export_failed" }, { status: 500 });
  }
}
