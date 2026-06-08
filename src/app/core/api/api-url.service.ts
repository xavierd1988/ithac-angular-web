import { Injectable } from '@angular/core';

import { appEnvironment } from '../config/app-environment';

@Injectable({ providedIn: 'root' })
export class ApiUrlService {
  readonly baseUrl = appEnvironment.apiBaseUrl;

  endpoint(path: string): string {
    if (path.startsWith('http')) {
      return path;
    }

    return `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
  }
}
