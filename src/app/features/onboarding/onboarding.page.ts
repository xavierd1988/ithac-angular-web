import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'ithac-onboarding-page',
  imports: [RouterLink],
  template: `
    <main class="onboarding page">
      <section class="hero">
        <span class="brand-mark">◆</span>
        <span class="eyebrow">ITHAC · social crypto signal intelligence</span>
        <h1>
          Follow the <span class="accent">winners</span>.<br />
          Avoid the <span class="dim">noise</span>.
        </h1>
        <p class="lead">
          Thousands of influencers call tokens every day. ITHAC tracks who calls what, scores their
          <strong>real track record</strong>, and turns it into ranked, actionable alerts — so you
          act on signal, not hype.
        </p>
        <div class="actions">
          <a class="button" routerLink="/login">Enter the signal desk →</a>
          <a class="button secondary" routerLink="/legal/terms">Terms</a>
        </div>
      </section>

      <section class="features" aria-label="What ITHAC does">
        <article class="feature panel">
          <span class="idx">01</span>
          <h3>Real-time alerts</h3>
          <p class="muted">
            The moment influential accounts move on a token, it surfaces in your live feed.
          </p>
        </article>
        <article class="feature panel">
          <span class="idx">02</span>
          <h3>Win-rate ranked</h3>
          <p class="muted">
            Every caller carries their measured track record — not their follower count.
          </p>
        </article>
        <article class="feature panel">
          <span class="idx">03</span>
          <h3>TIMEX outcomes</h3>
          <p class="muted">
            See the real price path after each call — GOOD TRADE, SUPER TRADE, or AVOID.
          </p>
        </article>
        <article class="feature panel">
          <span class="idx">04</span>
          <h3>Caller intelligence</h3>
          <p class="muted">Coins and influencers aggregated — who's hot, who lands, who to ignore.</p>
        </article>
      </section>
    </main>
  `,
  styles: `
    .onboarding {
      display: grid;
      align-content: center;
      gap: 3rem;
      min-height: 100vh;
      padding-block: 4rem;
    }

    .hero {
      display: grid;
      justify-items: start;
      max-width: 52rem;
      gap: 1.25rem;
    }

    .brand-mark {
      display: grid;
      place-items: center;
      width: 3rem;
      height: 3rem;
      border-radius: 0.9rem;
      background: linear-gradient(150deg, #ffd47a, #ff7a00);
      color: #1a1003;
      font-size: 1.2rem;
      box-shadow:
        0 0 0 1px rgba(255, 214, 122, 0.4),
        0 12px 30px -10px rgba(255, 138, 0, 0.7);
    }

    .eyebrow {
      color: var(--gold);
      font-size: 0.78rem;
      font-weight: 500;
      letter-spacing: 0.14em;
      text-transform: uppercase;
    }

    h1 {
      margin: 0;
      font-size: clamp(2.4rem, 7vw, 4.6rem);
      line-height: 1.02;
      font-weight: 500;
      letter-spacing: -0.02em;
    }

    h1 .accent {
      color: var(--gold-bright);
      text-shadow: 0 0 32px rgba(255, 176, 32, 0.4);
    }

    h1 .dim {
      color: var(--ink-dim);
    }

    .lead {
      margin: 0;
      max-width: 40rem;
      font-size: 1.1rem;
      line-height: 1.6;
      color: var(--ink-muted);
    }

    .lead strong {
      color: var(--ink);
    }

    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem;
      margin-top: 0.5rem;
    }

    .actions .button {
      min-height: 3rem;
      padding: 0.75rem 1.5rem;
      font-size: 1rem;
    }

    .features {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
      gap: 1rem;
    }

    .feature {
      display: grid;
      align-content: start;
      gap: 0.6rem;
      padding: 1.5rem;
    }

    .idx {
      font-size: 0.85rem;
      font-weight: 500;
      color: var(--gold);
      font-variant-numeric: tabular-nums;
      letter-spacing: 0.05em;
    }

    h3 {
      margin: 0;
      font-size: 1.1rem;
      font-weight: 500;
    }

    .feature p {
      margin: 0;
      font-size: 0.92rem;
      line-height: 1.5;
    }

    @media (max-width: 760px) {
      .onboarding {
        gap: 2.5rem;
        padding-block: 2.5rem;
      }
    }
  `
})
export class OnboardingPage {}
