import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';

import { ApiUrlService } from '../../core/api/api-url.service';

export interface HealthStatus {
  status: string;
  database?: string;
}

@Injectable({ providedIn: 'root' })
export class HealthApi {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = inject(ApiUrlService);

  check() {
    return this.http.get<HealthStatus>(this.apiUrl.endpoint('/health'));
  }
}
