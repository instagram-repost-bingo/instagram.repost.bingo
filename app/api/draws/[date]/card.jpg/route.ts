import { handleDrawCard } from "@/lib/api/draw-card";
import { getDb } from "@/lib/mongodb";
import { renderResultCardJpeg } from "@/lib/result-card";

export async function GET(request: Request, context: RouteContext<"/api/draws/[date]/card.jpg">): Promise<Response> {
  const { date } = await context.params;
  return handleDrawCard(request, date, {
    getDb,
    // Same key as the entries API: IPs are hashed with it, never stored.
    rateLimitSecret: process.env.TURNSTILE_SECRET_KEY,
    renderJpeg: renderResultCardJpeg,
  });
}
