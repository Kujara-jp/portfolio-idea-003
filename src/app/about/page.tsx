export default function AboutPage() {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <h1 className="text-3xl font-semibold tracking-tight text-slate-900">About</h1>
      <p className="mt-4 text-slate-600">
        This MVP is a starting point for a portfolio where project entries live in local MDX files.
      </p>
      <p className="mt-3 text-slate-600">
        Keep content in <code>content/projects</code>, update frontmatter, and the project list/detail pages update
        automatically.
      </p>
    </div>
  );
}
