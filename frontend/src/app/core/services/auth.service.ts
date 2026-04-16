import { Injectable, inject, signal, computed } from '@angular/core';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { ApiService } from './api.service';
import { AuthStatus, SessionInitResult, SessionStatus } from '../models/auth.model';
import { ApiResponse } from '../models/api-response.model';
import { environment } from '../../../environments/environment';

const TOKEN_KEY = 'at_app_token';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);

  private readonly _token = signal<string | null>(this.loadToken());
  readonly isLoggedIn = computed(() => !!this._token());
  readonly token = this._token.asReadonly();

  private loadToken(): string | null {
    return localStorage.getItem(TOKEN_KEY);
  }

  setToken(token: string): void {
    localStorage.setItem(TOKEN_KEY, token);
    this._token.set(token);
  }

  clearToken(): void {
    localStorage.removeItem(TOKEN_KEY);
    this._token.set(null);
  }

  initiateOAuth(): void {
    window.location.href = `${environment.apiUrl}/auth/airtable`;
  }

  getAuthStatus(): Observable<ApiResponse<AuthStatus>> {
    return this.api.get<ApiResponse<AuthStatus>>('/auth/status');
  }

  refreshToken(): Observable<ApiResponse<{ expiresAt: string; scope: string[] }>> {
    return this.api.post<ApiResponse<{ expiresAt: string; scope: string[] }>>('/auth/refresh');
  }

  logout(): Observable<ApiResponse<null>> {
    return this.api.delete<ApiResponse<null>>('/auth/logout').pipe(
      tap(() => {
        this.clearToken();
        this.router.navigate(['/auth/login']);
      })
    );
  }

  initScrapingSession(
    email?: string,
    password?: string
  ): Observable<ApiResponse<SessionInitResult>> {
    return this.api.post<ApiResponse<SessionInitResult>>('/scraping/session/init', {
      email,
      password,
    });
  }

  submitMfa(
    sessionId: string,
    code: string
  ): Observable<ApiResponse<null>> {
    return this.api.post<ApiResponse<null>>('/scraping/session/mfa', { sessionId, code });
  }

  getSessionStatus(): Observable<ApiResponse<SessionStatus>> {
    return this.api.get<ApiResponse<SessionStatus>>('/scraping/session/status');
  }
}
