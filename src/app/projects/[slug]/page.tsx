import Link from "next/link";
import { notFound } from "next/navigation";
import { MDXRemote } from "next-mdx-remote/rsc";

import { getProjectBySlug, getProjectSlugs } from "@/lib/projects";

type ProjectDetailPageProps = {
  params: Promise<{ slug: string }>;
};

type ProjectSummary = {
  problem: string;
  approach: string;
  outcome: string;
};

const projectSummaries: Record<string, ProjectSummary> = {
  helphub: {
    problem: "更新しやすく、読みやすい実績ページを短期間で用意したい。",
    approach: "MDX と frontmatter を使い、一覧と詳細を同じデータ構造で表示。",
    outcome: "制作と更新のフローが単純になり、公開までのリードタイムを短縮。",
  },
  "sample-site": {
    problem: "案件ごとに説明粒度が異なり、情報設計がばらついていた。",
    approach: "見出しと frontmatter を固定し、カード一覧と詳細の表現を統一。",
    outcome: "閲覧導線が整理され、モバイルでも要点が伝わりやすくなった。",
  },
  tooling: {
    problem: "高頻度で更新する知見を、コードと同じ場所で管理したい。",
    approach: "ファイルベースの MDX 運用で編集と公開の距離を最小化。",
    outcome: "修正反映が速くなり、運用コストを抑えた情報更新が可能になった。",
  },
};

function formatDate(date: string): string {
  return new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function getProjectSummary(slug: string): ProjectSummary {
  return (
    projectSummaries[slug] ?? {
      problem: "解決したい課題を短く整理して示す。",
      approach: "採用した方針と実装の要点を簡潔に説明する。",
      outcome: "実装後の変化と得られた結果を一文で伝える。",
    }
  );
}

export async function generateStaticParams(): Promise<Array<{ slug: string }>> {
  const slugs = await getProjectSlugs();

  return slugs.map((slug) => ({ slug }));
}

export default async function ProjectDetailPage({ params }: ProjectDetailPageProps) {
  const { slug } = await params;
  const project = await getProjectBySlug(slug);
  const detailSummary = getProjectSummary(slug);

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
                className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700"
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
              className="inline-flex items-center rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              Repository
            </a>
            <a
              href={project.demoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
            >
              Live demo
            </a>
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-600">Summary</h2>
          <div className="mt-3 space-y-2 text-sm text-slate-700">
            <p>
              <span className="font-semibold text-slate-900">課題:</span> {detailSummary.problem}
            </p>
            <p>
              <span className="font-semibold text-slate-900">施策:</span> {detailSummary.approach}
            </p>
            <p>
              <span className="font-semibold text-slate-900">結果:</span> {detailSummary.outcome}
            </p>
          </div>
        </div>
      </header>

      <div className="space-y-3 leading-7 text-slate-700">
        <MDXRemote source={project.content} />
      </div>
    </article>
  );
}
