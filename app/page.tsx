import { Suspense } from "react";
import { BingoBall } from "@/components/BingoBall";
import { Countdown } from "@/components/Countdown";
import { DrawHistory, DrawHistorySkeleton } from "@/components/DrawHistory";
import { EntryForm } from "@/components/EntryForm";
import { LastWinner, LastWinnerSkeleton } from "@/components/LastWinner";
import { WhoIsIn, WhoIsInSkeleton } from "@/components/WhoIsIn";
import {
  DRAW_TIME_LABEL,
  INSTAGRAM_HANDLE,
  INSTAGRAM_PROFILE_URL,
  POOL_DAYS,
} from "@/lib/config";

const HERO_BALLS = [
  { letter: "B", number: "7", tone: "accent" },
  { letter: "I", number: "23", tone: "paper" },
  { letter: "N", number: "38", tone: "ink" },
  { letter: "G", number: "52", tone: "accent" },
  { letter: "O", number: "71", tone: "paper" },
] as const;

export default function Home() {
  // Read on the server (the key is public) and passed to the form as a prop.
  const turnstileSiteKey = process.env.TURNSTILE_SITE_KEY || undefined;

  return (
    <>
      <a className="skip-link" href="#enter">
        Skip to the entry form
      </a>

      <main className="page">
        <div className="layout__row layout__row--top">
          <header className="hero">
            <div className="hero__balls" aria-hidden="true">
              {HERO_BALLS.map((ball) => (
                <BingoBall
                  key={ball.letter}
                  label={ball.number}
                  caption={ball.letter}
                  tone={ball.tone}
                  size="lg"
                  className="hero__ball"
                />
              ))}
            </div>

            <h1 className="wordmark">
              repost<span className="wordmark__dot">.</span>bingo
            </h1>

            <ol className="steps" aria-label="How it works">
              <li className="steps__item">
                <BingoBall label="1" size="sm" tone="ink" />
                <span>
                  Follow <strong>@{INSTAGRAM_HANDLE}</strong>.
                </span>
              </li>
              <li className="steps__item">
                <BingoBall label="2" size="sm" tone="ink" />
                <span>Paste your post link.</span>
              </li>
              <li className="steps__item">
                <BingoBall label="3" size="sm" tone="ink" />
                <span>One random post gets reposted every day, with credit.</span>
              </li>
            </ol>

            <a className="button button--ink hero__follow" href={INSTAGRAM_PROFILE_URL}>
              Follow @{INSTAGRAM_HANDLE}
              <span aria-hidden="true" className="button__arrow">
                &rarr;
              </span>
            </a>
          </header>

          <section className="draw-panel" aria-label="Tonight's draw">
            <div className="draw-panel__next">
              <h2 className="draw-panel__title">Next draw in</h2>
              <Countdown />
              <p className="draw-panel__note">Every night at {DRAW_TIME_LABEL} UK time.</p>
            </div>
            <div className="draw-panel__last">
              <Suspense fallback={<LastWinnerSkeleton />}>
                <LastWinner />
              </Suspense>
            </div>
          </section>
        </div>

        <div className="layout__row">
          <section id="enter" className="card entry" aria-labelledby="enter-heading">
            <h2 id="enter-heading" className="section-title">
              Enter the draw
            </h2>
            <EntryForm turnstileSiteKey={turnstileSiteKey} />
          </section>

          <div className="layout__side">
            <section className="pool" aria-labelledby="pool-heading">
              <h2 id="pool-heading" className="section-title">
                Who&apos;s in
              </h2>
              <Suspense fallback={<WhoIsInSkeleton />}>
                <WhoIsIn />
              </Suspense>
            </section>

            <section className="history" aria-labelledby="history-heading">
              <div className="history__head">
                <h2 id="history-heading" className="section-title">
                  Draw history
                </h2>
                <p className="history__sub">
                  One draw a night, at {DRAW_TIME_LABEL} UK time.
                </p>
              </div>
              <Suspense fallback={<DrawHistorySkeleton />}>
                <DrawHistory />
              </Suspense>
            </section>
          </div>
        </div>
      </main>

      <footer className="footer">
        <div className="footer__inner">
          <h2 className="footer__title">The rules</h2>
          <ul className="rules">
            <li>Free to enter.</li>
            <li>One draw a day, at midnight ({DRAW_TIME_LABEL} UK time).</li>
            <li>Posts that aren&apos;t picked stay in the pool for {POOL_DAYS} days.</li>
            <li>The prize is a repost with credit. Nothing else.</li>
            <li>You must follow @{INSTAGRAM_HANDLE} to enter.</li>
          </ul>
          <p className="footer__small">
            We store your post link, the username of the account that posted it (which we look up on
            Instagram) and when you entered. Entries are public: the &ldquo;Who&apos;s in&rdquo; list
            shows each username and post. To stop spam, Cloudflare Turnstile checks that entries come
            from people, and we keep a scrambled (hashed) copy of your IP address for about 10 minutes.
          </p>
          <p className="footer__disclaimer">Not affiliated with Instagram or Meta.</p>
        </div>
      </footer>
    </>
  );
}
