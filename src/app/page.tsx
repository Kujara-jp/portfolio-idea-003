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
        <p className="text-sm font-medium uppercase tracking-[0.2em] text-slate-500">業務改善・社内DX向けポートフォリオ</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
          現場課題を整理し、仕組みと運用で改善につなげる制作実績
        </h1>
        <p className="mt-3 max-w-2xl text-lg text-slate-700">
          手作業によるミスや属人化しやすい業務を、要件整理と小さな改善の積み重ねで扱いやすくすることを重視しています。
          社内SE・DX推進の現場で活かせる制作例と改善の考え方をまとめています。
        </p>
        <ul className="mt-4 space-y-2 text-sm text-slate-600">
          <li>• 課題を整理し、業務に沿った形で要件へ落とし込む</li>
          <li>• 小さく実装し、使いながら改善を重ねる</li>
          <li>• 保守性・運用負荷・再発防止まで含めて整える</li>
        </ul>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href="/projects"
            className="rounded-full bg-slate-900 px-5 py-2 text-sm font-medium text-white hover:bg-slate-700"
          >
            制作実績を見る
          </Link>
          <Link
            href="#demo-links"
            className="rounded-full border border-slate-300 px-5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            デモを見る
          </Link>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <h2 className="text-lg font-semibold tracking-tight text-slate-900">できること</h2>
        <p className="mt-2 text-sm text-slate-600">
          現場で起こる手作業の負荷や確認コストを減らすために、業務整理・画面改善・運用を見据えた実装を行います。
        </p>
        <ul className="mt-4 space-y-2 text-sm text-slate-600">
          <li>・業務整理: ヒアリング、要件整理、手順化、改善方針の明確化</li>
          <li>・実装と改善: Webアプリ制作、UI調整、不具合修正、小さな改善の継続</li>
          <li>・運用視点: 権限、ログ、保守性、再発防止を意識した整備</li>
        </ul>
      </section>

      <section id="demo-links" className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <h2 className="text-lg font-semibold tracking-tight text-slate-900">デモ・制作例</h2>
        <p className="mt-2 text-sm text-slate-600">
          実際の画面や動作を通じて、業務改善の考え方と実装の方向性を確認できるようにしています。
        </p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Link
            href="https://helphub-pink.vercel.app/"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-xl border border-slate-200 bg-slate-50 p-4 hover:bg-slate-100"
          >
            <h3 className="text-base font-semibold text-slate-900">Helphub（お問い合わせアプリ）</h3>
            <p className="mt-2 text-sm text-slate-600">
              問い合わせ管理をチケット化し、履歴・添付・アクセス制御を含めて扱いやすくしたデモです。
            </p>
          </Link>
          <Link
            href="https://script.google.com/macros/s/AKfycbw4iMuLsAs7Qfzio8AMCQkP8UERdF2O95crLyvJKfnchSdH9lgBrZSv3VaFcJvG5M68pQ/exec"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-xl border border-slate-200 bg-slate-50 p-4 hover:bg-slate-100"
          >
            <h3 className="text-base font-semibold text-slate-900">抵抗値計算ツール（GAS）</h3>
            <p className="mt-2 text-sm text-slate-600">
              手作業計算の負荷とミスを減らすことを目的にした、現場改善向けの支援ツールです。
            </p>
          </Link>
        </div>
        <p className="mt-4 text-sm text-slate-600">デモの詳細な閲覧方法は、応募時に必要に応じてご案内します。</p>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-slate-900">主な制作実績</h2>
            <p className="mt-1 text-sm text-slate-600">
              業務改善や保守運用の視点を重視して取り組んだ制作例を掲載しています。
            </p>
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
