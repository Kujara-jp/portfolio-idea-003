import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "お問い合わせ | K.F",
  description: "K.Fへのお問い合わせはメールまたはGitHubからどうぞ。",
};

export default function ContactPage() {
  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <p className="text-sm font-medium text-slate-500">お問い合わせ</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
          Contact
        </h1>
        <p className="mt-3 text-base text-slate-700">
          お仕事のご依頼・採用に関するお問い合わせは、以下のいずれかからご連絡ください。
        </p>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8 space-y-6">
        <div>
          <p className="text-sm font-medium text-slate-500">メール</p>
          <p className="mt-2 text-base font-medium text-slate-900">
            kf.works.contact [at] gmail.com
          </p>
          <p className="mt-1 text-sm text-slate-500">
            ※ [at] を @ に置き換えてご送信ください。
          </p>
        </div>

        <div className="border-t border-slate-100 pt-6">
          <p className="text-sm font-medium text-slate-500">GitHub</p>
          <div className="mt-2">
            <a
              href="https://github.com/Kujara-jp"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-full border border-slate-300 px-6 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100"
            >
              <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.92.359.31.678.921.678 1.856 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
              </svg>
              GitHub — Kujara-jp
            </a>
          </div>
        </div>

        <div className="border-t border-slate-100 pt-6">
          <p className="text-sm font-medium text-slate-500">こんなご相談、歓迎します</p>
          <ul className="mt-3 space-y-2 text-base text-slate-700">
            <li>・社内の手作業・属人化業務の改善</li>
            <li>・Webアプリ・管理ツールの開発</li>
            <li>・業務フロー整理・DX推進の相談</li>
            <li>・その他、業務改善に関するご依頼</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
