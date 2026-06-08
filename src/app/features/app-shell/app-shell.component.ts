import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

import { AuthService } from '../../core/auth/auth.service';

@Component({
  selector: 'ithac-app-shell',
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  template: `
    <main class="shell">
      <aside class="sidebar">
        <a class="brand" routerLink="/app/live" aria-label="ITHAC Live">
          <span class="brand-mark">◆</span>
          <span class="brand-text">
            <strong>ITHAC</strong>
            <small>Signal portal</small>
          </span>
        </a>

        <nav aria-label="Primary">
          <a routerLink="/app/live" routerLinkActive="active"><span class="nav-dot"></span>Live</a>
          <a routerLink="/app/coins" routerLinkActive="active"><span class="nav-dot"></span>Coins</a>
          <a routerLink="/app/influencers" routerLinkActive="active"
            ><span class="nav-dot"></span>Influencers</a
          >
          <a routerLink="/app/settings" routerLinkActive="active"
            ><span class="nav-dot"></span>Settings</a
          >
        </nav>

        <section class="session">
          <span class="status-pill warn dot">Premium gate · mock</span>
          <strong class="who">{{ auth.user()?.displayName }}</strong>
          <button class="button secondary" type="button" (click)="auth.signOut()">Sign out</button>
        </section>
      </aside>

      <section class="content">
        <router-outlet />
      </section>
    </main>
  `,
  styles: `
    .shell {
      display: grid;
      grid-template-columns: 16rem minmax(0, 1fr);
      min-height: 100vh;
    }

    .sidebar {
      position: sticky;
      top: 0;
      display: flex;
      height: 100vh;
      flex-direction: column;
      gap: 1.75rem;
      padding: 1.5rem 1.15rem;
      border-right: 1px solid rgba(255, 255, 255, 0.08);
      background:
        linear-gradient(180deg, rgba(255, 176, 32, 0.05), transparent 16rem),
        rgba(8, 11, 28, 0.66);
      backdrop-filter: blur(22px);
      -webkit-backdrop-filter: blur(22px);
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 0.8rem;
      padding: 0.25rem 0.35rem;
    }

    .brand-mark {
      display: grid;
      width: 2.5rem;
      height: 2.5rem;
      place-items: center;
      border-radius: 0.85rem;
      background: linear-gradient(150deg, #ffd47a, #ff7a00);
      color: #1a1003;
      font-size: 1.05rem;
      box-shadow:
        0 0 0 1px rgba(255, 214, 122, 0.4),
        0 10px 26px -10px rgba(255, 138, 0, 0.7);
    }

    .brand-text {
      display: grid;
      line-height: 1.15;
    }

    .brand-text strong {
      font-size: 1.05rem;
      letter-spacing: 0.14em;
    }

    .brand-text small {
      color: var(--ink-dim);
      font-size: 0.72rem;
      letter-spacing: 0.04em;
    }

    nav {
      display: grid;
      gap: 0.2rem;
    }

    nav a {
      display: flex;
      align-items: center;
      gap: 0.7rem;
      border-radius: 0.7rem;
      padding: 0.72rem 0.85rem;
      color: var(--ink-muted);
      font-weight: 500;
      font-size: 0.95rem;
      transition:
        background 140ms ease,
        color 140ms ease;
    }

    .nav-dot {
      width: 0.4rem;
      height: 0.4rem;
      border-radius: 999px;
      background: currentColor;
      opacity: 0.35;
      transition:
        opacity 140ms ease,
        box-shadow 140ms ease;
    }

    nav a:hover {
      background: rgba(255, 255, 255, 0.05);
      color: var(--ink);
    }

    nav a.active {
      background: rgba(255, 176, 32, 0.1);
      color: var(--gold-bright);
    }

    nav a.active .nav-dot {
      opacity: 1;
      box-shadow: 0 0 10px var(--gold);
    }

    .session {
      display: grid;
      gap: 0.7rem;
      margin-top: auto;
    }

    .session .who {
      font-size: 0.95rem;
    }

    .content {
      min-width: 0;
      padding: 1.75rem 0 4rem;
    }

    @media (max-width: 820px) {
      .shell {
        grid-template-columns: 1fr;
      }

      .sidebar {
        position: static;
        height: auto;
      }
    }
  `
})
export class AppShellComponent {
  readonly auth = inject(AuthService);
}
