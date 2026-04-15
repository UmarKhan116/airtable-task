import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-oauth-callback',
  standalone: true,
  imports: [CommonModule, MatProgressSpinnerModule, MatIconModule, MatButtonModule],
  template: `
    <div class="callback-container">
      @if (isLoading) {
        <div class="callback-state">
          <mat-spinner diameter="48"></mat-spinner>
          <p>Completing authentication...</p>
        </div>
      } @else if (error) {
        <div class="callback-state error">
          <mat-icon class="error-icon">error_outline</mat-icon>
          <h3>Authentication Failed</h3>
          <p>{{ error }}</p>
          <button mat-raised-button color="primary" (click)="retry()">
            Try Again
          </button>
        </div>
      } @else {
        <div class="callback-state success">
          <mat-icon class="success-icon">check_circle</mat-icon>
          <h3>Authentication Successful</h3>
          <p>Redirecting to dashboard...</p>
        </div>
      }
    </div>
  `,
  styles: [`
    .callback-container {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      background: #f5f5f5;
    }

    .callback-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 16px;
      padding: 48px;
      background: white;
      border-radius: 12px;
      box-shadow: 0 2px 12px rgba(0,0,0,0.12);
      min-width: 300px;
      text-align: center;

      h3 { margin: 0; }
      p { color: rgba(0,0,0,0.6); margin: 0; }
    }

    .error-icon { color: #f44336; font-size: 48px; width: 48px; height: 48px; }
    .success-icon { color: #4caf50; font-size: 48px; width: 48px; height: 48px; }
  `]
})
export class OAuthCallbackComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly authService = inject(AuthService);

  isLoading = true;
  error: string | null = null;

  ngOnInit(): void {
    const params = this.route.snapshot.queryParams;
    const token = params['token'];
    const error = params['error'];

    if (error) {
      this.error = decodeURIComponent(error);
      this.isLoading = false;
      return;
    }

    if (!token) {
      this.error = 'No authentication token received.';
      this.isLoading = false;
      return;
    }

    this.authService.setToken(decodeURIComponent(token));
    this.isLoading = false;

    setTimeout(() => this.router.navigate(['/dashboard']), 1000);
  }

  retry(): void {
    this.router.navigate(['/auth/login']);
  }
}
