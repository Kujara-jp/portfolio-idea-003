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

// MiniMax API call
async function callMiniMax(prompt: string, systemPrompt: string): Promise<string> {
  const apiKey = process.env.MINIMAX_API_KEY;
  const groupId = process.env.MINIMAX_GROUP_ID;

  if (!apiKey || !groupId) {
    throw new Error("MiniMax credentials not configured");
  }

  const response = await fetch(
    `https://api.minimax.chat/v1/text/chatcompletion_v2?GroupId=${groupId}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "MiniMax-Text-01",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt },
        ],
        temperature: 0.7,
      }),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`MiniMax API error: ${error}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || "";
}

// Claude API call for translation
async function callClaude(prompt: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error("Anthropic API key not configured");
  }

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
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const error = await response.text();
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
  const result = await callMiniMax(prompt, systemPrompt);

  try {
    return JSON.parse(result);
  } catch {
    // Default fallback if parsing fails
    return { isImportant: true, category: "other", summary: article.content?.slice(0, 200) || "" };
  }
}

// Agent 3: Translator Agent - Translate to Japanese
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
  const result = await callClaude(prompt);

  try {
    return JSON.parse(result);
  } catch {
    // Default fallback
    return { jaTitle: title, jaSummary: summary };
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
  const result = await callMiniMax(prompt, systemPrompt);

  try {
    const parsed = JSON.parse(result);
    return `${parsed.headline}\n${parsed.description}`;
  } catch {
    return `${title}\n${summary}`;
  }
}

// Main handler
export async function POST(request: NextRequest) {
  // Verify CRON_SECRET
  const authHeader = request.headers.get("authorization");
  const cronSecret = authHeader?.replace("Bearer ", "");

  if (cronSecret !== CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Agent 1: Search
    const searchResults = await searchAgent();

    const collectedArticles: AiNews[] = [];

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

      // Agent 4: Editor
      const edited = await editorAgent(translated.jaTitle, translated.jaSummary);
      const [editedTitle, editedSummary] = edited.split("\n");

      // Upsert to Supabase (skip if duplicate)
      const newsData: Omit<AiNews, "id"> = {
        title: editedTitle || translated.jaTitle,
        summary: editedSummary || translated.jaSummary,
        source_url: article.url,
        source_name: new URL(article.url).hostname.replace("www.", ""),
        published_at: article.published_date || null,
        collected_at: new Date().toISOString(),
        category: analysis.category || "other",
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
    });
  } catch (error) {
    console.error("Error collecting news:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
