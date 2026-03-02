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


// Claude API call for translation
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
    // Check for insufficient credits error
    if (error.includes("insufficient_quota") || error.includes("rate_limit") || error.includes("credit")) {
      throw new Error("INSUFFICIENT_CREDITS");
    }
    throw new Error(`Claude API error: ${error}`);
  }

  const data = await response.json();
  return data.content?.[0]?.text || "";
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

// Agent 2: Reader Agent - Analyze article importance
async function readerAgent(article: TavilySearchResult): Promise<{
  isImportant: boolean;
  category: string;
  summary: string;
}> {
  const prompt = `
Please analyze this article and determine:
1. Is this important AI news worth including? (yes/no)
2. What category does it belong to? (model/tool/research/other)
3. Provide a brief summary in English.

Article:
Title: ${article.title}
Content: ${article.content}
URL: ${article.url}

Respond in JSON format:
{"isImportant": true/false, "category": "model/tool/research/other", "summary": "..."}
`;

  const systemPrompt = "You are an expert AI news analyst. Respond only with valid JSON.";

  try {
    const result = await callClaude(prompt, systemPrompt);
    return JSON.parse(result);
  } catch (error) {
    console.warn("Reader agent failed, using fallback:", error instanceof Error ? error.message : "Unknown error");
    // Default fallback if parsing fails
    return { isImportant: true, category: "other", summary: article.content?.slice(0, 200) || "" };
  }
}

// Agent 3: Translator Agent - Translate to Japanese (Claude → pending fallback)
async function translatorAgent(title: string, summary: string): Promise<{
  jaTitle: string;
  jaSummary: string;
  provider: "claude" | "none";
  needsRetry: boolean;
}> {
  const prompt = `
Translate the following to Japanese. Keep the meaning accurate and natural.

Title: ${title}
Summary: ${summary}

Respond in JSON format:
{"jaTitle": "...", "jaSummary": "..."}
`;

  // Try Claude for translation
  try {
    const systemPrompt = "You are a professional translator. Translate accurately to Japanese. Respond only with valid JSON.";
    const result = await callClaude(prompt);
    const parsed = JSON.parse(result);
    return { ...parsed, provider: "claude", needsRetry: false };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    // Check for insufficient credits - mark for retry later
    if (errorMsg === "INSUFFICIENT_CREDITS") {
      console.warn("Claude credits exhausted, marking for retry later");
      return { jaTitle: title, jaSummary: summary, provider: "none", needsRetry: true };
    }
    // Other errors - fallback to English
    console.warn("Claude translation failed, using English:", errorMsg);
    return { jaTitle: title, jaSummary: summary, provider: "none", needsRetry: false };
  }
}

// Agent 4: Editor Agent - Final summary
async function editorAgent(title: string, summary: string): Promise<string> {
  const prompt = `
Create a compelling headline and short description (max 100 chars for headline, 200 chars for description) in Japanese for this article.

Title: ${title}
Content: ${summary}

Respond in JSON format:
{"headline": "...", "description": "..."}
`;

  const systemPrompt = "You are an expert editor. Create engaging headlines. Respond only with valid JSON.";

  try {
    const result = await callClaude(prompt, systemPrompt);
    const parsed = JSON.parse(result);
    return `${parsed.headline}\n${parsed.description}`;
  } catch (error) {
    console.warn("Editor agent failed, using original text:", error instanceof Error ? error.message : "Unknown error");
    return `${title}\n${summary}`;
  }
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
    const translatorProviders: ("claude" | "none")[] = [];

    for (const article of searchResults) {
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

      // Upsert to Supabase (skip if duplicate)
      const newsData: Omit<AiNews, "id"> = {
        title: editedTitle,
        summary: editedSummary,
        source_url: article.url,
        source_name: new URL(article.url).hostname.replace("www.", ""),
        published_at: article.published_date || null,
        collected_at: new Date().toISOString(),
        category: analysis.category || "other",
        translation_status: translationStatus,
        original_title: translated.needsRetry ? article.title : undefined,
        original_summary: translated.needsRetry ? analysis.summary : undefined,
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
