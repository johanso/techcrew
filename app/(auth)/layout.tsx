import { DatabaseIcon, LockKeyholeIcon, ShieldCheckIcon } from "lucide-react";

import { APP_NAME, Brand } from "@/components/brand";

const HIGHLIGHTS = [
  {
    Icon: ShieldCheckIcon,
    title: "Your computer, your data",
    body: "TechTeam runs on this computer and listens on this address only. Nothing is hosted for you.",
  },
  {
    Icon: LockKeyholeIcon,
    title: "One sign-in with GitHub",
    body: "No password and no sign-up: the same step proves who you are and lets agents reach your repository.",
  },
  {
    Icon: DatabaseIcon,
    title: "Ready when you are",
    body: "Create a workspace, link a GitHub repository and let your agents get to work.",
  },
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-svh bg-background lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div className="flex flex-col px-6 py-6 sm:px-10 sm:py-8">
        <Brand />
        <main className="flex flex-1 items-center justify-center py-12">
          <div className="w-full max-w-sm animate-in fade-in slide-in-from-bottom-2 duration-500">{children}</div>
        </main>
        <p className="text-center text-xs text-muted-foreground lg:text-left">
          © {new Date().getFullYear()} {APP_NAME}. All rights reserved.
        </p>
      </div>

      <aside className="relative hidden overflow-hidden bg-darkest text-lightest lg:flex lg:flex-col lg:justify-center lg:p-16">
        {/* Decorative backdrop: soft glows over a faded grid. */}
        <div
          aria-hidden
          className="absolute inset-0 bg-[linear-gradient(to_right,rgb(255_255_255/0.04)_1px,transparent_1px),linear-gradient(to_bottom,rgb(255_255_255/0.04)_1px,transparent_1px)] bg-size-[48px_48px] mask-[radial-gradient(ellipse_at_center,black_30%,transparent_75%)]"
        />
        <div aria-hidden className="absolute -top-40 -right-32 size-[520px] rounded-full bg-brand/30 blur-3xl" />
        <div aria-hidden className="absolute -bottom-48 -left-24 size-[480px] rounded-full bg-action/20 blur-3xl" />

        <div className="relative mx-auto flex w-full max-w-md flex-col gap-10">
          <div className="flex flex-col gap-4">
            <span className="w-fit rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-light">
              Build faster. Ship sooner.
            </span>
            <h2 className="text-4xl leading-tight font-semibold tracking-tight text-balance">
              Everything your team needs,{" "}
              <span className="text-brand-accent">
                in one place.
              </span>
            </h2>
          </div>

          <ul className="flex flex-col gap-6">
            {HIGHLIGHTS.map(({ Icon, title, body }) => (
              <li key={title} className="flex gap-4">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-action">
                  <Icon className="size-5" />
                </span>
                <div className="flex flex-col gap-1">
                  <p className="font-medium">{title}</p>
                  <p className="text-sm leading-relaxed text-dark">{body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}
