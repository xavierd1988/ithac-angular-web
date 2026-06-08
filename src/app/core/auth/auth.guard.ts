import { inject } from '@angular/core';
import { CanActivateChildFn, CanActivateFn, Router } from '@angular/router';

import { AuthService } from './auth.service';

const requireAuth = (url: string) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.isAuthenticated()) {
    return true;
  }

  return router.createUrlTree(['/login'], {
    queryParams: {
      redirectTo: url
    }
  });
};

export const authGuard: CanActivateFn = (_route, state) => requireAuth(state.url);
export const authChildGuard: CanActivateChildFn = (_route, state) => requireAuth(state.url);
