import Link from "next/link";

import { getAllProjects } from "@/lib/projects";

function formatDate(date: string): string {
  return new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default async function HomePage() {
  const projects = await getAllProjects();
  const featuredProjects = projects.filter((project) => project.featured);
  const featuredCards = (featuredProjects.length >= 3 ? featuredProjects : projects).slice(0, 3);

  return (
    <div className="space-y-10">
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <p className="text-sm font-medium uppercase tracking-[0.2em] text-slate-500">ポートフォリオ</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">&lt;NAME&gt;</h1>
        <p className="mt-3 max-w-2xl text-lg text-slate-700">
          Next.js を中心に、使いやすいWeb体験を実装するプロダクト志向の開発者です。
        </p>
        <ul className="mt-4 space-y-2 text-sm text-slate-600">
          <li>• TypeScript と App Router で素早く MVP を実装</li>
          <li>• MDX を活用したコンテンツ主導の運用フロー</li>
          <li>• lint / build を軸にした安定したリリース運用</li>
        </ul>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href="/projects"
            className="rounded-full bg-slate-900 px-5 py-2 text-sm font-medium text-white hover:bg-slate-700"
          >
            作品一覧を見る
          </Link>
          <Link
            href="/about"
            className="rounded-full border border-slate-300 px-5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            このMVPについて
          </Link>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <h2 className="text-lg font-semibold tracking-tight text-slate-900">できること / 技術スタック</h2>
        <p className="mt-2 text-sm text-slate-600">
          MVP 構築から運用改善まで、読みやすさと保守性を重視した実装を中心に対応します。
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {[
            "Next.js",
            "React",
            "TypeScript",
            "Tailwind",
            "Supabase",
            "PostgreSQL",
            "GitHub",
            "GitHub Actions",
            "Vercel",
            "UI/UX",
            "DX/業務改善",
          ].map((skill) => (
            <span
              key={skill}
              className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700"
            >
              {skill}
            </span>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.16em] text-slate-500">注目</p>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">ピックアップ作品</h2>
          </div>
          <Link href="/projects" className="text-sm font-medium text-slate-600 hover:text-slate-900">
            すべて見る
          </Link>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {featuredCards.map((project) => (
            <article key={project.slug} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">
                公開日 {formatDate(project.date)}
              </p>
              <h3 className="mt-2 text-lg font-semibold text-slate-900">{project.title}</h3>
              <p className="mt-2 text-sm text-slate-600">{project.summary}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {project.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600"
                  >
                    {tag}
                  </span>
                ))}
              </div>
              <Link
                href={`/projects/${project.slug}`}
                className="mt-4 inline-block text-sm font-medium text-slate-700 hover:text-slate-900"
              >
                詳細を見る
              </Link>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
