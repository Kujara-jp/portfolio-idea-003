import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "自己紹介 | K.F",
  description: "製造業出身。現場課題を整理し、AIと仕組みで改善につなげるDX推進エンジニアのプロフィール。",
};

export default function AboutPage() {
  const skills = [
    {
      category: "フロントエンド",
      items: ["Next.js", "React", "TypeScript", "Tailwind CSS"],
    },
    {
      category: "バックエンド",
      items: ["Supabase", "PostgreSQL"],
    },
    {
      category: "自動化",
      items: ["Google Apps Script", "Vercel Cron Jobs"],
    },
    {
      category: "AI活用",
      items: ["Claude Code", "Agent Teams", "Tavily", "MiniMax", "DeepL API"],
    },
    {
      category: "インフラ",
      items: ["Vercel", "GitHub Actions"],
    },
  ];

  return (
    <div className="space-y-8">
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
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

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <h2 className="text-lg font-semibold tracking-tight text-slate-900">スキル・技術スタック</h2>
        <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {skills.map((skill) => (
            <div key={skill.category}>
              <h3 className="text-sm font-semibold text-slate-900">{skill.category}</h3>
              <div className="mt-2 flex flex-wrap gap-2">
                {skill.items.map((item) => (
                  <span
                    key={item}
                    className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600"
                  >
                    {item}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <h2 className="text-lg font-semibold tracking-tight text-slate-900">リンク</h2>
        <ul className="mt-4 space-y-2 text-sm text-slate-600">
          <li>
            GitHub:{" "}
            <a
              href="https://github.com/Kujara-jp"
              target="_blank"
              rel="noopener noreferrer"
              className="text-slate-700 hover:underline"
            >
              https://github.com/Kujara-jp
            </a>
          </li>
        </ul>
      </section>
    </div>
  );
}
