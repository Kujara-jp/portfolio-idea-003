export default function AboutPage() {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <h1 className="text-3xl font-semibold tracking-tight text-slate-900">About</h1>
      <div className="mt-4 space-y-2 text-slate-600">
        <p>Name: &lt;NAME&gt;</p>
        <p>Email: &lt;EMAIL&gt;</p>
        <p>Company: &lt;COMPANY&gt;</p>
        <p>GitHub: &lt;GITHUB_URL&gt;</p>
      </div>
    </section>
  );
}
