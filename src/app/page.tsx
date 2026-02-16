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
  const featuredProjects = projects.filter((project) => project.featured).slice(0, 3);

  return (
    <div className="space-y-10">
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <p className="text-sm font-medium uppercase tracking-[0.2em] text-slate-500">Portfolio MVP</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
          Build, publish, and iterate content with MDX.
        </h1>
        <p className="mt-4 max-w-2xl text-slate-600">
          This starter shows a minimal, content-driven project setup using Next.js App Router and local MDX files.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href="/projects"
            className="rounded-full bg-slate-900 px-5 py-2 text-sm font-medium text-white hover:bg-slate-700"
          >
            Browse Projects
          </Link>
          <Link
            href="/about"
            className="rounded-full border border-slate-300 px-5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            About This MVP
          </Link>
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Featured Projects</h2>
          <Link href="/projects" className="text-sm font-medium text-slate-600 hover:text-slate-900">
            View all
          </Link>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {featuredProjects.map((project) => (
            <article key={project.slug} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">
                {formatDate(project.date)}
              </p>
              <h3 className="mt-2 text-lg font-semibold text-slate-900">{project.title}</h3>
              <p className="mt-2 text-sm text-slate-600">{project.summary}</p>
              <Link
                href={`/projects/${project.slug}`}
                className="mt-4 inline-block text-sm font-medium text-slate-700 hover:text-slate-900"
              >
                Read details
              </Link>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
