import Link from "next/link";

import { getAllProjects } from "@/lib/projects";

function formatDate(date: string): string {
  return new Date(date).toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default async function ProjectsPage() {
  const projects = await getAllProjects();

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900">作品一覧</h1>
        <p className="max-w-2xl text-slate-600">
          業務改善や保守運用の視点を重視して取り組んだ制作例です。
          各作品の詳細では、課題へのアプローチと結果음을まとめています。
        </p>
      </header>

      <div className="grid gap-5 md:grid-cols-2">
        {projects.map((project) => (
          <article key={project.slug} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">
              公開日 {formatDate(project.date)}
            </p>
            <Link href={`/projects/${project.slug}`} className="mt-2 block text-xl font-semibold tracking-tight text-slate-900 hover:text-slate-600">
              {project.title}
            </Link>
            <p className="mt-2 text-sm leading-6 text-slate-600">{project.summary}</p>
            <p className="mt-3 text-xs font-medium uppercase tracking-[0.16em] text-slate-500">タグ</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {project.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600"
                >
                  {tag}
                </span>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <Link
                href={`/projects/${project.slug}`}
                className="inline-block text-sm font-medium text-slate-700 hover:text-slate-900"
              >
                詳細を見る
              </Link>
              {project.demoUrl && (
                <a
                  href={project.demoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block text-sm font-medium text-blue-600 hover:text-blue-800"
                >
                  デモを見る →
                </a>
              )}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
