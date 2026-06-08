import { Routes } from '@angular/router';

import { authChildGuard, authGuard } from './core/auth/auth.guard';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    redirectTo: 'onboarding'
  },
  {
    path: 'onboarding',
    loadComponent: () =>
      import('./features/onboarding/onboarding.page').then((m) => m.OnboardingPage)
  },
  {
    path: 'login',
    loadComponent: () => import('./features/auth/login.page').then((m) => m.LoginPage)
  },
  {
    path: 'legal/privacy',
    loadComponent: () => import('./features/legal/privacy.page').then((m) => m.PrivacyPage)
  },
  {
    path: 'legal/terms',
    loadComponent: () => import('./features/legal/terms.page').then((m) => m.TermsPage)
  },
  {
    path: 'app',
    canActivate: [authGuard],
    canActivateChild: [authChildGuard],
    loadComponent: () =>
      import('./features/app-shell/app-shell.component').then((m) => m.AppShellComponent),
    children: [
      {
        path: '',
        pathMatch: 'full',
        redirectTo: 'influencers'
      },
      {
        path: 'live',
        loadComponent: () =>
          import('./features/live-alerts/live-alerts.page').then((m) => m.LiveAlertsPage)
      },
      {
        path: 'alerts/:alertId',
        loadComponent: () =>
          import('./features/signal-detail/signal-detail.page').then((m) => m.SignalDetailPage)
      },
      {
        path: 'coins',
        loadComponent: () =>
          import('./features/coin-analytics/coin-list.page').then((m) => m.CoinListPage)
      },
      {
        path: 'influencers',
        loadComponent: () =>
          import('./features/influencers/influencer-list.page').then((m) => m.InfluencerListPage)
      },
      {
        path: 'influencers/:influencerId',
        loadComponent: () =>
          import('./features/influencers/influencer-detail.page').then(
            (m) => m.InfluencerDetailPage
          )
      },
      {
        path: 'settings',
        loadComponent: () => import('./features/settings/settings.page').then((m) => m.SettingsPage)
      }
    ]
  },
  {
    path: '**',
    redirectTo: 'onboarding'
  }
];
