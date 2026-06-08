import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'ithac-privacy-page',
  imports: [RouterLink],
  template: `
    <main class="page legal">
      <a routerLink="/onboarding">Back</a>
      <h1>Privacy</h1>
      <section class="panel">
        <p>Placeholder for the web privacy policy. Final copy should match the production legal docs.</p>
      </section>
    </main>
  `,
  styles: `
    .legal {
      display: grid;
      gap: 1rem;
      padding-block: 2rem;
    }

    h1 {
      margin: 0;
      font-size: 2.4rem;
    }

    .panel {
      padding: 1rem;
    }
  `
})
export class PrivacyPage {}
