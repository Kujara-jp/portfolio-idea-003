"use client";

import { useEffect, useState } from "react";

type AiNewsItem = {
  id: string;
  title: string;
  summary: string;
  source_url: string;
  source_name: string | null;
  published_at: string | null;
  collected_at: string;
  category: string;
};

const categories = [
  { value: "all", label: "すべて" },
  { value: "model", label: "モデル" },
  { value: "tool", label: "ツール" },
  { value: "research", label: "研究" },
  { value: "other", label: "その他" },
];

export default function AINewsPage() {
  const [articles, setArticles] = useState<AiNewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState("all");
  const [collecting, setCollecting] = useState(false);

  const fetchNews = async (cat: string) => {
    setLoading(true);
    try {
      const url = `/api/news/list${cat !== "all" ? `?category=${cat}` : ""}`;
      const res = await fetch(url);
      const data = await res.json();
      setArticles(data.articles || []);
    } catch (error) {
      console.error("Error fetching news:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNews(category);
  }, [category]);

  const handleManualCollect = async () => {
    setCollecting(true);
    try {
      // In production, this would use the CRON_SECRET
      // For now, we'll just refresh the list
      await fetchNews(category);
    } catch (error) {
      console.error("Error collecting news:", error);
    } finally {
      setCollecting(false);
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "";
    const date = new Date(dateStr);
    return date.toLocaleDateString("ja-JP", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900 mb-2">AI News</h1>
        <p className="text-slate-600">
          最新のAIニュースを自動収集・翻訳・要約
        </p>
      </header>

      {/* Category Filter */}
      <div className="flex gap-2 mb-6 flex-wrap">
        {categories.map((cat) => (
          <button
            key={cat.value}
            onClick={() => setCategory(cat.value)}
            className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
              category === cat.value
                ? "bg-slate-900 text-white"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Manual Collect Button */}
      <div className="mb-6">
        <button
          onClick={handleManualCollect}
          disabled={collecting}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {collecting ? "更新中..." : "更新"}
        </button>
      </div>

      {/* News List */}
      {loading ? (
        <div className="text-center py-12 text-slate-500">読み込み中...</div>
      ) : articles.length === 0 ? (
        <div className="text-center py-12 text-slate-500">
          記事がありません
        </div>
      ) : (
        <div className="space-y-4">
          {articles.map((article) => (
            <article
              key={article.id}
              className="border border-slate-200 rounded-lg p-4 hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <span
                      className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                        article.category === "model"
                          ? "bg-blue-100 text-blue-700"
                          : article.category === "tool"
                          ? "bg-green-100 text-green-700"
                          : article.category === "research"
                          ? "bg-purple-100 text-purple-700"
                          : "bg-slate-100 text-slate-700"
                      }`}
                    >
                      {categories.find((c) => c.value === article.category)
                        ?.label || "その他"}
                    </span>
                    <span className="text-xs text-slate-500">
                      {article.source_name}
                    </span>
                    <span className="text-xs text-slate-400">
                      {formatDate(article.collected_at)}
                    </span>
                  </div>
                  <h2 className="text-lg font-semibold text-slate-900 mb-2">
                    {article.title}
                  </h2>
                  <p className="text-slate-600 text-sm mb-3">
                    {article.summary}
                  </p>
                  <a
                    href={article.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 text-sm hover:underline"
                  >
                    元記事 →
                  </a>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
