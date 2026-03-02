import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin, AiNews } from "@/lib/supabase";

// CRON_SECRET check
const CRON_SECRET = process.env.CRON_SECRET;

interface TavilySearchResult {
  title: string;
  url: string;
  content: string;
  published_date: string;
  score: number;
}


// DeepL API call for translation
async function translateWithDeepL(text: string, targetLang: string = "JA"): Promise<string> {
  const apiKey = process.env.DEEPL_API_KEY;

  console.log("[DeepL API] API Key present:", !!apiKey);

  if (!apiKey) {
    console.error("[DeepL API] ERROR: DeepL API key not configured");
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

  console.log("[DeepL API] Response status:", response.status);

  if (!response.ok) {
    const error = await response.text();
    console.error("[DeepL API] ERROR response:", error);
    if (error.includes("quota") || error.includes("limit")) {
      throw new Error("DEEPL_QUOTA_EXCEEDED");
    }
    throw new Error(`DeepL API error: ${error}`);
  }

  const data = await response.json();
  const result = data.translations?.[0]?.text || "";
  console.log("[DeepL API] Translated:", result.substring(0, 50));

  return result;
}

// Tavily search
async function searchAINews(query: string): Promise<TavilySearchResult[]> {
  const apiKey = process.env.TAVILY_API_KEY;

  if (!apiKey) {
    throw new Error("Tavily API key not configured");
  }

  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: 3,
      search_depth: "basic",
      include_answer: false,
      include_raw_content: false,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Tavily API error: ${error}`);
  }

  const data = await response.json();
  return data.results || [];
}

// Agent 1: Search Agent - Search for AI news
async function searchAgent(): Promise<TavilySearchResult[]> {
  const results = await searchAINews("latest artificial intelligence news 2026");
  return results;
}

// Agent 2: Reader Agent - Analyze article importance (simplified, no AI needed)
async function readerAgent(article: TavilySearchResult): Promise<{
  isImportant: boolean;
  category: string;
  summary: string;
}> {
  // Simple analysis without AI - extract summary from content
  const summary = article.content?.slice(0, 300) || article.title;

  // Basic category detection based on keywords
  let category = "other";
  const titleLower = article.title.toLowerCase();
  if (titleLower.includes("model") || titleLower.includes("gpt") || titleLower.includes("claude") || titleLower.includes("gemini")) {
    category = "model";
  } else if (titleLower.includes("tool") || titleLower.includes("feature") || titleLower.includes("launch") || titleLower.includes("release")) {
    category = "tool";
  } else if (titleLower.includes("research") || titleLower.includes("paper") || titleLower.includes("study") || titleLower.includes("发现")) {
    category = "research";
  }

  return { isImportant: true, category, summary };
}

// Agent 3: Translator Agent - Translate to Japanese using DeepL
async function translatorAgent(title: string, summary: string): Promise<{
  jaTitle: string;
  jaSummary: string;
  provider: "deepl" | "none";
  needsRetry: boolean;
}> {
  console.log("[TranslatorAgent] Starting translation for:", title.substring(0, 50));

  try {
    // Translate title
    console.log("[TranslatorAgent] Translating title with DeepL...");
    const jaTitle = await translateWithDeepL(title);

    // Translate summary
    console.log("[TranslatorAgent] Translating summary with DeepL...");
    const jaSummary = await translateWithDeepL(summary);

    console.log("[TranslatorAgent] Translation complete");
    return { jaTitle, jaSummary, provider: "deepl", needsRetry: false };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    console.error("[TranslatorAgent] ERROR:", errorMsg);
    // Check for quota exceeded
    if (errorMsg === "DEEPL_QUOTA_EXCEEDED") {
      console.warn("[TranslatorAgent] DeepL quota exceeded, marking for retry");
      return { jaTitle: title, jaSummary: summary, provider: "none", needsRetry: true };
    }
    // Other errors - mark for retry
    console.warn("[TranslatorAgent] DeepL translation failed, marking for retry:", errorMsg);
    return { jaTitle: title, jaSummary: summary, provider: "none", needsRetry: true };
  }
}

// Agent 4: Editor Agent - Final summary (simplified, no AI needed)
async function editorAgent(title: string, summary: string): Promise<string> {
  // Simple headline creation - use title as headline, truncate summary
  const headline = title.length > 100 ? title.substring(0, 97) + "..." : title;
  const description = summary.length > 200 ? summary.substring(0, 197) + "..." : summary;
  return `${headline}\n${description}`;
}

// Main handler
export async function POST(request: NextRequest) {
  // Verify CRON_SECRET
  const authHeader = request.headers.get("authorization");
  const cronSecret = authHeader?.replace("Bearer ", "");
  const isDev = process.env.NODE_ENV === "development";

  // Allow in development mode or with valid CRON_SECRET
  if (!isDev && cronSecret !== CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Agent 1: Search
    const searchResults = await searchAgent();

    const collectedArticles: AiNews[] = [];
    const translatorProviders: ("deepl" | "none")[] = [];
    const MAX_ARTICLES = 3;

    for (const article of searchResults.slice(0, MAX_ARTICLES)) {
      // Agent 2: Reader - Check importance
      const analysis = await readerAgent(article);

      if (!analysis.isImportant) {
        continue;
      }

      // Agent 3: Translator
      const translated = await translatorAgent(
        article.title,
        analysis.summary
      );
      console.log(`[Translator] Used: ${translated.provider.toUpperCase()}, needsRetry: ${translated.needsRetry}`);
      translatorProviders.push(translated.provider);

      // Determine translation status
      const translationStatus = translated.needsRetry ? "pending" : "completed";

      // Agent 4: Editor (only if translation succeeded)
      let editedTitle = translated.jaTitle;
      let editedSummary = translated.jaSummary;

      if (!translated.needsRetry) {
        try {
          const edited = await editorAgent(translated.jaTitle, translated.jaSummary);
          const [title, summary] = edited.split("\n");
          editedTitle = title || translated.jaTitle;
          editedSummary = summary || translated.jaSummary;
        } catch (e) {
          console.warn("Editor agent failed, using translated text");
        }
      }

      // Translate full content for detail page
      let contentJa = "";
      const originalContent = article.content || "";
      if (originalContent && !translated.needsRetry) {
        try {
          console.log("[Content Translator] Translating full content...");
          contentJa = await translateWithDeepL(originalContent);
          console.log("[Content Translator] Content translated, length:", contentJa.length);
        } catch (error) {
          console.warn("Content translation failed:", error instanceof Error ? error.message : "Unknown error");
        }
      }

      // Upsert to Supabase (skip if duplicate)
      const newsData: Omit<AiNews, "id"> = {
        title: editedTitle,
        summary: editedSummary,
        content_ja: contentJa || undefined,
        source_url: article.url,
        source_name: new URL(article.url).hostname.replace("www.", ""),
        published_at: article.published_date || null,
        collected_at: new Date().toISOString(),
        category: analysis.category || "other",
        translation_status: translationStatus,
        original_title: translated.needsRetry ? article.title : undefined,
        original_summary: translated.needsRetry ? analysis.summary : undefined,
        original_content: translated.needsRetry ? originalContent : undefined,
      };

      const { error } = await getSupabaseAdmin()
        .from("ai_news")
        .upsert(newsData, { onConflict: "source_url" });

      if (!error) {
        collectedArticles.push({ id: "", ...newsData });
      }
    }

    return NextResponse.json({
      success: true,
      collected: collectedArticles.length,
      articles: collectedArticles,
      translatorProvider: translatorProviders[0] || "unknown",
    });
  } catch (error) {
    console.error("Error collecting news:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
