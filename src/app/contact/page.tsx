export default function ContactPage() {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <h1 className="text-3xl font-semibold tracking-tight text-slate-900">お問い合わせ</h1>
      <p className="mt-4 text-slate-600">連絡先が確定するまでは、以下のプレースホルダーを使用しています。</p>
      <a
        href="mailto:<EMAIL>"
        className="mt-4 inline-flex rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
      >
        &lt;EMAIL&gt;
      </a>
      <p className="mt-4 text-slate-600">公開前に &lt;NAME&gt;・&lt;EMAIL&gt;・&lt;COMPANY&gt; を実値に置き換えてください。</p>
    </section>
  );
}
