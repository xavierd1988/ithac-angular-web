import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';

import { AuthService } from './auth.service';

export const tokenInterceptor: HttpInterceptorFn = (request, next) => {
  if (request.url.endsWith('/health')) {
    return next(request);
  }

  const token = inject(AuthService).token();

  if (!token) {
    return next(request);
  }

  return next(
    request.clone({
      setHeaders: {
        Authorization: `Bearer ${token}`
      }
    })
  );
};
