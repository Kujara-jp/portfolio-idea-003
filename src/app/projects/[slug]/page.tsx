import Link from "next/link";
import { notFound } from "next/navigation";
import { MDXRemote } from "next-mdx-remote/rsc";

import { getProjectBySlug, getProjectSlugs } from "@/lib/projects";

type ProjectDetailPageProps = {
  params: Promise<{ slug: string }>;
};

function formatDate(date: string): string {
  return new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export async function generateStaticParams(): Promise<Array<{ slug: string }>> {
  const slugs = await getProjectSlugs();

  return slugs.map((slug) => ({ slug }));
}

export default async function ProjectDetailPage({ params }: ProjectDetailPageProps) {
  const { slug } = await params;
  const project = await getProjectBySlug(slug);

  if (!project) {
    notFound();
  }

  return (
    <article className="space-y-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <Link href="/projects" className="text-sm font-medium text-slate-600 hover:text-slate-900">
        ← Back to projects
      </Link>

      <header className="space-y-4">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900">{project.title}</h1>
        <p className="text-slate-600">{project.summary}</p>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">
            {formatDate(project.date)}
          </p>
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
          <div className="mt-4 flex flex-wrap gap-3">
            <a
              href={project.repoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              Repository
            </a>
            <a
              href={project.demoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
            >
              Live demo
            </a>
          </div>
        </div>
      </header>

      <div className="space-y-3 leading-7 text-slate-700">
        <MDXRemote source={project.content} />
      </div>
    </article>
  );
}
