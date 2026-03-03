import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";
import { getSupabaseAdmin, AiNews } from "@/lib/supabase";

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
      include_raw_content: true,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Tavily API error: ${error}`);
  }

  const data = await response.json();
  return data.results || [];
}

// Tavily extract - Get full article content from URL
async function extractArticleContent(url: string): Promise<string> {
  const apiKey = process.env.TAVILY_API_KEY;

  console.log("[Extract] Starting extraction for:", url);

  if (!apiKey) {
    throw new Error("Tavily API key not configured");
  }

  const response = await fetch("https://api.tavily.com/extract", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      api_key: apiKey,
      urls: [url],
    }),
  });

  console.log("[Extract] Response status:", response.status);

  if (!response.ok) {
    const error = await response.text();
    console.warn("[Extract] Error response:", error);
    return "";
  }

  const data = await response.json();
  console.log("[Extract] Response data:", JSON.stringify(data).substring(0, 500));

  const results = data.results || [];
  console.log("[Extract] Results count:", results.length);

  if (results.length > 0 && results[0].content) {
    const contentLength = results[0].content.length;
    console.log("[Extract] Content length:", contentLength);
    console.log("[Extract] Content preview:", results[0].content.substring(0, 200));
    return results[0].content;
  }

  console.log("[Extract] No content found in results");
  return "";
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
  // Simple analysis without AI - extract summary from content (up to 500 chars)
  const summary = article.content?.slice(0, 500) || article.title;

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
  console.log("[Collect] Starting news collection...");
  console.log("[Collect] TAVILY_API_KEY present:", !!process.env.TAVILY_API_KEY);
  console.log("[Collect] DEEPL_API_KEY present:", !!process.env.DEEPL_API_KEY);

  // Verify Cron Job request
  // Supports two authentication methods:
  // 1. Vercel Cron Job: x-vercel-signature header with HMAC SHA-256 verification
  // 2. Manual execution: Authorization header with Bearer token
  const cronSecret = process.env.CRON_SECRET;
  const isDev = process.env.NODE_ENV === "development";

  // Development mode allows direct access
  if (!isDev) {
    if (!cronSecret) {
      console.error("[Collect] CRON_SECRET not configured");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const vercelSignature = request.headers.get("x-vercel-signature");
    const authHeader = request.headers.get("authorization");
    const bearerToken = authHeader?.replace("Bearer ", "");

    console.log("[Collect] x-vercel-signature present:", !!vercelSignature);
    console.log("[Collect] Authorization present:", !!authHeader);

    let isValidAuth = false;

    // Method 1: Vercel Cron Job - verify x-vercel-signature
    if (vercelSignature) {
      const body = await request.text();
      const expectedSignature = createHmac("sha256", cronSecret).update(body).digest("hex");
      isValidAuth = vercelSignature === `sha256=${expectedSignature}`;
      console.log("[Collect] Vercel Cron signature valid:", isValidAuth);

      // Re-create Request object with the body we've already read
      if (isValidAuth) {
        request = new NextRequest(request.url, {
          method: "POST",
          headers: request.headers,
          body: body,
        });
      }
    }
    // Method 2: Manual execution - verify Authorization Bearer token
    else if (bearerToken) {
      isValidAuth = bearerToken === cronSecret;
      console.log("[Collect] Manual auth valid:", isValidAuth);
    }

    if (!isValidAuth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    // Agent 1: Search
    console.log("[Collect] Calling searchAgent...");
    const searchResults = await searchAgent();
    console.log("[Collect] Search results count:", searchResults.length);

    const collectedArticles: AiNews[] = [];
    const translatorProviders: ("deepl" | "none")[] = [];
    const MAX_ARTICLES = 3;

    for (const article of searchResults.slice(0, MAX_ARTICLES)) {
      // Agent 2: Reader - Check importance
      const analysis = await readerAgent(article);

      if (!analysis.isImportant) {
        continue;
      }

      // Extract full article content
      let originalContent = "";
      try {
        console.log("[Extract] Getting full content from:", article.url);
        originalContent = await extractArticleContent(article.url);
        console.log("[Extract] Extracted content length:", originalContent.length);
      } catch (error) {
        console.error("[Extract] ERROR:", error instanceof Error ? error.message : "Unknown error");
        originalContent = ""; // Reset to empty on error
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
      console.log("[Collect] originalContent length:", originalContent.length);
      console.log("[Collect] translated.needsRetry:", translated.needsRetry);

      if (originalContent && !translated.needsRetry) {
        try {
          console.log("[Content Translator] Translating full content...");
          console.log("[Content Translator] originalContent preview:", originalContent.substring(0, 200));
          contentJa = await translateWithDeepL(originalContent);
          console.log("[Content Translator] contentJa length:", contentJa.length);
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
