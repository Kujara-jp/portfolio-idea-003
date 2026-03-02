"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type AiNewsItem = {
  id: string;
  title: string;
  summary: string;
  content_ja?: string;
  source_url: string;
  source_name: string | null;
  published_at: string | null;
  collected_at: string;
  translation_status?: "pending" | "completed";
};

export default function AINewsDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const router = useRouter();
  const [article, setArticle] = useState<AiNewsItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [id, setId] = useState<string>("");

  useEffect(() => {
    params.then((resolvedParams) => {
      setId(resolvedParams.id);
    });
  }, [params]);

  useEffect(() => {
    if (!id) return;

    const fetchArticle = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/news/${id}`);
        const data = await res.json();

        if (res.ok) {
          setArticle(data.article);
        } else {
          console.error("Error fetching article:", data.error);
        }
      } catch (error) {
        console.error("Error fetching article:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchArticle();
  }, [id]);

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "";
    const date = new Date(dateStr);
    return date.toLocaleDateString("ja-JP", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="text-center py-12 text-slate-500">読み込み中...</div>
      </div>
    );
  }

  if (!article) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="text-center py-12 text-slate-500">記事が見つかりません</div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {/* Back Button */}
      <button
        onClick={() => router.back()}
        className="mb-6 text-blue-600 hover:underline flex items-center gap-1"
      >
        ← 戻る
      </button>

      {/* Article Header */}
      <header className="mb-8">
        <div className="flex items-center gap-3 mb-3">
          {article.translation_status === "pending" && (
            <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-orange-100 text-orange-700">
              未翻訳
            </span>
          )}
          <span className="text-sm text-slate-500">{article.source_name}</span>
          <span className="text-sm text-slate-400">
            {formatDate(article.collected_at)}
          </span>
        </div>
        <h1 className="text-3xl font-bold text-slate-900 mb-4">
          {article.title}
        </h1>
        <p className="text-lg text-slate-600 mb-4">{article.summary}</p>
        <a
          href={article.source_url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 hover:underline"
        >
          元記事 →
        </a>
      </header>

      {/* Full Content */}
      {article.content_ja ? (
        <article className="prose prose-slate max-w-none">
          <h2 className="text-xl font-semibold text-slate-900 mb-4">
            記事全文
          </h2>
          <div className="bg-white border border-slate-200 rounded-lg p-6 text-slate-700 whitespace-pre-wrap">
            {article.content_ja}
          </div>
        </article>
      ) : (
        <div className="text-center py-8 text-slate-500">
          全文はまだ翻訳されていません
        </div>
      )}
    </div>
  );
}
