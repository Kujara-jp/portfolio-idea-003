import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin, AiNews } from "@/lib/supabase";

// DeepL API call for translation
async function translateWithDeepL(text: string, targetLang: string = "JA"): Promise<string> {
  const apiKey = process.env.DEEPL_API_KEY;

  if (!apiKey) {
    throw new Error("DeepL API key not configured");
  }

  const response = await fetch("https://api-free.deepl.com/v1/translate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `DeepL-Auth-Key ${apiKey}`,
    },
    body: JSON.stringify({
      text: [text],
      target_lang: targetLang,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    if (error.includes("quota") || error.includes("limit")) {
      throw new Error("DEEPL_QUOTA_EXCEEDED");
    }
    throw new Error(`DeepL API error: ${error}`);
  }

  const data = await response.json();
  return data.translations?.[0]?.text || "";
}

// Editor Agent - Simple text truncation
function editorAgent(title: string, summary: string): { editedTitle: string; editedSummary: string } {
  const headline = title.length > 100 ? title.substring(0, 97) + "..." : title;
  const description = summary.length > 200 ? summary.substring(0, 197) + "..." : summary;
  return { editedTitle: headline, editedSummary: description };
}

// Main handler - No auth required for frontend usage
export async function POST(request: NextRequest) {
  try {
    // Fetch pending articles
    const { data: pendingArticles, error: fetchError } = await getSupabaseAdmin()
      .from("ai_news")
      .select("*")
      .eq("translation_status", "pending")
      .order("collected_at", { ascending: false })
      .limit(10);

    if (fetchError) {
      throw fetchError;
    }

    if (!pendingArticles || pendingArticles.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No pending articles to translate",
        translated: 0,
      });
    }

    const translated: string[] = [];

    for (const article of pendingArticles) {
      const originalTitle = article.original_title || article.title;
      const originalSummary = article.original_summary || article.summary;

      try {
        // Translate title
        const jaTitle = await translateWithDeepL(originalTitle);

        // Translate summary
        const jaSummary = await translateWithDeepL(originalSummary);

        // Edit
        const edited = editorAgent(jaTitle, jaSummary);

        // Update in database
        await getSupabaseAdmin()
          .from("ai_news")
          .update({
            title: edited.editedTitle || jaTitle,
            summary: edited.editedSummary || jaSummary,
            translation_status: "completed",
          })
          .eq("id", article.id);

        translated.push(article.id);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : "Unknown error";
        console.error(`Failed to translate article ${article.id}:`, errorMsg);

        // If quota exceeded, stop here
        if (errorMsg === "DEEPL_QUOTA_EXCEEDED") {
          return NextResponse.json({
            success: false,
            error: "Quota exceeded",
            translated: translated.length,
            remaining: pendingArticles.length - translated.length,
          });
        }
      }
    }

    return NextResponse.json({
      success: true,
      translated: translated.length,
      remaining: pendingArticles.length - translated.length,
    });
  } catch (error) {
    console.error("Error retrying translation:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
