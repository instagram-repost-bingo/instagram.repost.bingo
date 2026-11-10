import { handleDrawStory } from "@/lib/api/draw-card";
import { getDb } from "@/lib/mongodb";
import { renderResultStoryJpeg } from "@/lib/result-card";

export async function GET(request: Request, context: RouteContext<"/api/draws/[date]/story.jpg">): Promise<Response> {
  const { date } = await context.params;
  return handleDrawStory(request, date, {
    getDb,
    // Same key as the card: IPs are hashed with it, never stored. One bucket.
    rateLimitSecret: process.env.TURNSTILE_SECRET_KEY,
    renderJpeg: renderResultStoryJpeg,
  });
}
