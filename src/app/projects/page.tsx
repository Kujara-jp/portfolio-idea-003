import Link from "next/link";

import { getAllProjects } from "@/lib/projects";

function formatDate(date: string): string {
  return new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
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
          作品データは <code>content/projects</code> の MDX ファイルから読み込んでいます。
        </p>
      </header>

      <div className="grid gap-5 md:grid-cols-2">
        {projects.map((project) => (
          <article key={project.slug} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">
              公開日 {formatDate(project.date)}
            </p>
            <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-900">{project.title}</h2>
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
            <Link
              href={`/projects/${project.slug}`}
              className="mt-4 inline-block text-sm font-medium text-slate-700 hover:text-slate-900"
            >
              作品を見る
            </Link>
          </article>
        ))}
      </div>
    </div>
  );
}
