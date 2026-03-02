import { NextRequest, NextResponse } from "next/server";
import { getSupabase, AiNews } from "@/lib/supabase";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const category = searchParams.get("category");
  const status = searchParams.get("status"); // "pending" or "completed"
  const limit = parseInt(searchParams.get("limit") || "20");
  const offset = parseInt(searchParams.get("offset") || "0");

  try {
    let query = getSupabase()
      .from("ai_news")
      .select("*", { count: "exact" })
      .order("collected_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (category && category !== "all") {
      query = query.eq("category", category);
    }

    // Only apply status filter if status param is provided and not "all"
    if (status && status !== "all") {
      query = query.eq("translation_status", status);
    }

    const { data, error, count } = await query;

    if (error) {
      console.warn("DB query error (possibly missing columns):", error.message);
      // If error is about missing column, return empty results
      if (error.message.includes("translation_status") || error.code === "427003") {
        return NextResponse.json({
          articles: [],
          total: 0,
          limit,
          offset,
          warning: "DB migration needed - translation_status column may not exist",
        });
      }
      throw error;
    }

    return NextResponse.json({
      articles: data || [],
      total: count || 0,
      limit,
      offset,
    });
  } catch (error) {
    console.error("Error fetching news:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
