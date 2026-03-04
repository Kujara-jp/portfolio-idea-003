import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "自己紹介 | K.F",
  description: "製造業出身。現場課題を整理し、AIと仕組みで改善につなげるDX推進エンジニアのプロフィール。",
};

const skillCategories = [
  {
    category: "フロントエンド",
    items: ["Next.js", "React", "TypeScript", "Tailwind CSS"],
    badgeColor: "bg-blue-100 text-blue-800",
  },
  {
    category: "バックエンド",
    items: ["Supabase", "PostgreSQL"],
    badgeColor: "bg-green-100 text-green-800",
  },
  {
    category: "自動化",
    items: ["Google Apps Script", "Vercel Cron Jobs"],
    badgeColor: "bg-purple-100 text-purple-800",
  },
  {
    category: "AI活用",
    items: ["Claude Code", "Agent Teams", "Tavily", "MiniMax", "DeepL API"],
    badgeColor: "bg-orange-100 text-orange-800",
  },
  {
    category: "インフラ",
    items: ["Vercel", "GitHub Actions"],
    badgeColor: "bg-gray-100 text-gray-700",
  },
];

export default function AboutPage() {
  return (
    <div className="space-y-8">
      {/* ヒーローセクション */}
      <section className="rounded-2xl border border-slate-200 bg-slate-100 p-6 shadow-sm sm:p-10">
        <p className="text-sm font-medium uppercase tracking-[0.2em] text-slate-500">自己紹介</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
          製造業の現場経験を持つ、AI活用型の業務改善エンジニア
        </h1>
        <div className="mt-6 space-y-4 text-base leading-7 text-slate-600">
          <p>
            製造業での現場経験を通じて、手作業によるミスや属人化しやすい業務の課題を肌で感じてきました。
            その経験から「整理して、仕組み化して、運用まで考える」というアプローチでDX推進に取り組んでいます。
          </p>
          <p>
            独学でNext.js・TypeScript・Supabase・GASを習得し、AIツールを活用した開発（バイブコーディング）を実践。
            複数のAIサービスを組み合わせたAgent Teams構成による自動化システムの構築まで手がけています。
          </p>
          <p>関西在住。リモート・通勤いずれも対応可能です。</p>
        </div>
      </section>

      {/* スキルセクション */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <h2 className="text-lg font-semibold tracking-tight text-slate-900">技術スタック</h2>
        <div className="mt-6 grid gap-6 md:grid-cols-2">
          {skillCategories.map((skill) => (
            <div key={skill.category}>
              <h3 className="text-sm font-semibold text-slate-500">{skill.category}</h3>
              <div className="mt-2 flex flex-wrap gap-2">
                {skill.items.map((item) => (
                  <span
                    key={item}
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${skill.badgeColor}`}
                  >
                    {item}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* リンクセクション */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="flex items-center">
          <a
            href="https://github.com/Kujara-jp"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-slate-900 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-slate-700"
          >
            GitHub → Kujara-jp
          </a>
        </div>
      </section>
    </div>
  );
}
