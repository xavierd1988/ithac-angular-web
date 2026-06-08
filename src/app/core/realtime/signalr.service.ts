import { inject, Injectable, signal } from '@angular/core';
import { HubConnection, HubConnectionBuilder, LogLevel } from '@microsoft/signalr';

import { appEnvironment } from '../config/app-environment';
import { AuthService } from '../auth/auth.service';
import { RealtimeStatus } from './realtime-status.model';

@Injectable({ providedIn: 'root' })
export class SignalrService {
  private readonly auth = inject(AuthService);
  private connection: HubConnection | null = null;

  readonly status = signal<RealtimeStatus>('disconnected');
  readonly lastError = signal<string | null>(null);
  readonly lastMessage = signal<unknown | null>(null);
  readonly messageSequence = signal(0);

  connect(): void {
    if (this.connection || this.status() === 'mock') {
      return;
    }

    if (appEnvironment.useMockData) {
      this.status.set('mock');
      return;
    }

    if (!appEnvironment.enableRealtime) {
      this.status.set('disabled');
      return;
    }

    this.status.set('connecting');
    this.lastError.set(null);

    this.connection = new HubConnectionBuilder()
      .withUrl(appEnvironment.signalrHubUrl, {
        accessTokenFactory: () => this.auth.token() ?? ''
      })
      .withAutomaticReconnect()
      .configureLogging(LogLevel.Warning)
      .build();

    this.connection.onreconnecting((error) => {
      this.status.set('reconnecting');
      this.lastError.set(error?.message ?? null);
    });

    this.connection.onreconnected(() => {
      this.status.set('connected');
      this.lastError.set(null);
    });

    this.connection.onclose((error) => {
      this.status.set(error ? 'error' : 'disconnected');
      this.lastError.set(error?.message ?? null);
      this.connection = null;
    });

    this.connection.on('CryptoMentionAlert', (alert: unknown) => {
      this.lastMessage.set(alert);
      this.messageSequence.update((value) => value + 1);
      console.info('ITHAC live alert received', alert);
    });

    void this.connection
      .start()
      .then(() => {
        this.status.set('connected');
      })
      .catch((error: unknown) => {
        this.status.set('error');
        this.lastError.set(error instanceof Error ? error.message : 'SignalR connection failed');
        this.connection = null;
      });
  }

  disconnect(): void {
    const connection = this.connection;
    this.connection = null;

    if (!connection) {
      this.status.set('disconnected');
      return;
    }

    void connection.stop().finally(() => {
      this.status.set('disconnected');
    });
  }
}
