import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin, AiNews } from "@/lib/supabase";

// Claude API call
async function callClaude(prompt: string, systemPrompt?: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error("Anthropic API key not configured");
  }

  const messages = [];
  if (systemPrompt) {
    messages.push({ role: "system", content: systemPrompt });
  }
  messages.push({ role: "user", content: prompt });

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      messages,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    if (error.includes("insufficient_quota") || error.includes("rate_limit") || error.includes("credit")) {
      throw new Error("INSUFFICIENT_CREDITS");
    }
    throw new Error(`Claude API error: ${error}`);
  }

  const data = await response.json();
  return data.content?.[0]?.text || "";
}

// Translator Agent
async function translatorAgent(title: string, summary: string): Promise<{
  jaTitle: string;
  jaSummary: string;
}> {
  const prompt = `
Translate the following to Japanese. Keep the meaning accurate and natural.

Title: ${title}
Summary: ${summary}

Respond in JSON format:
{"jaTitle": "...", "jaSummary": "..."}
`;

  const systemPrompt = "You are a professional translator. Translate accurately to Japanese. Respond only with valid JSON.";
  const result = await callClaude(prompt, systemPrompt);
  return JSON.parse(result);
}

// Editor Agent
async function editorAgent(title: string, summary: string): Promise<{ editedTitle: string; editedSummary: string }> {
  const prompt = `
Create a compelling headline and short description (max 100 chars for headline, 200 chars for description) in Japanese for this article.

Title: ${title}
Content: ${summary}

Respond in JSON format:
{"headline": "...", "description": "..."}
`;

  const systemPrompt = "You are an expert editor. Create engaging headlines. Respond only with valid JSON.";
  const result = await callClaude(prompt, systemPrompt);
  const parsed = JSON.parse(result);
  return { editedTitle: parsed.headline, editedSummary: parsed.description };
}

// Main handler
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = authHeader?.replace("Bearer ", "");
  const isDev = process.env.NODE_ENV === "development";

  if (!isDev && cronSecret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
        // Translate
        const translatedText = await translatorAgent(originalTitle, originalSummary);

        // Edit
        const edited = await editorAgent(translatedText.jaTitle, translatedText.jaSummary);

        // Update in database
        await getSupabaseAdmin()
          .from("ai_news")
          .update({
            title: edited.editedTitle || translatedText.jaTitle,
            summary: edited.editedSummary || translatedText.jaSummary,
            translation_status: "completed",
          })
          .eq("id", article.id);

        translated.push(article.id);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : "Unknown error";
        console.error(`Failed to translate article ${article.id}:`, errorMsg);

        // If still insufficient credits, stop here
        if (errorMsg === "INSUFFICIENT_CREDITS") {
          return NextResponse.json({
            success: false,
            error: "Insufficient credits",
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
