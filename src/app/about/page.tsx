import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "自己紹介 | K.F",
  description:
    "製造業出身。現場課題を整理し、AIと仕組みで改善につなげるDX推進エンジニアのプロフィール。",
};

const skills = [
  {
    category: "フロントエンド",
    color: "bg-blue-100 text-blue-800",
    dot: "bg-blue-400",
    items: ["Next.js", "React", "TypeScript", "Tailwind CSS"],
  },
  {
    category: "バックエンド",
    color: "bg-emerald-100 text-emerald-800",
    dot: "bg-emerald-400",
    items: ["Supabase", "PostgreSQL"],
  },
  {
    category: "AI 活用",
    color: "bg-orange-100 text-orange-800",
    dot: "bg-orange-400",
    items: ["Claude Code", "Agent Teams", "Tavily", "MiniMax", "DeepL API"],
  },
  {
    category: "自動化",
    color: "bg-violet-100 text-violet-800",
    dot: "bg-violet-400",
    items: ["Google Apps Script", "Vercel Cron Jobs"],
  },
  {
    category: "インフラ",
    color: "bg-slate-200 text-slate-700",
    dot: "bg-slate-400",
    items: ["Vercel", "GitHub Actions"],
  },
];

export default function AboutPage() {
  return (
    <div className="space-y-10">
      {/* ── ヒーロー ── */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <p className="text-sm font-medium uppercase tracking-[0.2em] text-slate-500">
          自己紹介
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
          製造業の現場経験を持つ、AI活用型の業務改善エンジニア
        </h1>
        <div className="mt-3 space-y-3 text-base text-slate-700">
          <p>
            製造業での現場経験を通じて、手作業によるミスや属人化しやすい業務の課題を肌で感じてきました。その経験から「整理して、仕組み化して、運用まで考える」というアプローチでDX推進に取り組んでいます。
          </p>
          <p>
            独学でNext.js・TypeScript・Supabase・GASを習得し、AIツールを活用した開発（バイブコーディング）を実践。複数のAIサービスを組み合わせたAgent
            Teams構成による自動化システムの構築まで手がけています。
          </p>
          <p className="text-slate-500">
            関西在住。リモート・通勤いずれも対応可能です。
          </p>
        </div>
      </section>

      {/* ── 技術スタック ── */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <p className="text-sm font-medium uppercase tracking-[0.2em] text-slate-500">
          技術スタック
        </p>
        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          {skills.map((skill) => (
            <div key={skill.category}>
              <div className="mb-2 flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${skill.dot}`} />
                <span className="text-sm font-semibold text-slate-700">
                  {skill.category}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {skill.items.map((item) => (
                  <span
                    key={item}
                    className={`rounded-full px-3 py-1 text-xs font-medium ${skill.color}`}
                  >
                    {item}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── リンク ── */}
      <section className="flex items-center gap-4">
        <a
          href="https://github.com/Kujara-jp"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-full border border-slate-300 px-6 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100"
        >
          <svg
            className="h-4 w-4"
            fill="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.92.359.31.678.921.678 1.856 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
              clipRule="evenodd"
            />
          </svg>
          GitHub — Kujara-jp
        </a>
      </section>
    </div>
  );
}
