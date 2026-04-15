import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatCardModule, MatIconModule],
  template: `
    <div class="login-container">
      <mat-card class="login-card">
        <mat-card-header>
          <div class="login-logo">
            <mat-icon>grid_on</mat-icon>
          </div>
          <mat-card-title>Airtable Integration</mat-card-title>
          <mat-card-subtitle>Connect your Airtable workspace to get started</mat-card-subtitle>
        </mat-card-header>

        <mat-card-content>
          <p class="login-description">
            Sign in with your Airtable account to sync your bases, tables, and records.
          </p>
        </mat-card-content>

        <mat-card-actions style="justify-content: center;">
          <button mat-raised-button color="primary" (click)="login()" class="login-btn">
            <mat-icon>login</mat-icon>
            Connect with Airtable
          </button>
        </mat-card-actions>
      </mat-card>
    </div>
  `,
  styles: [`
    .login-container {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      background: #f5f5f5;
    }

    .login-card {
      width: 400px;
      padding: 24px;
    }

    .login-logo {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 64px;
      height: 64px;
      background: #1976d2;
      border-radius: 12px;
      margin: 0 auto 16px;

      mat-icon {
        color: white;
        font-size: 36px;
        width: 36px;
        height: 36px;
      }
    }

    mat-card-header {
      flex-direction: column;
      align-items: center;
      text-align: center;
      margin-bottom: 16px;
    }

    .login-description {
      color: rgba(0,0,0,0.6);
      text-align: center;
      margin: 0;
    }

    .login-btn {
      gap: 8px;
      padding: 8px 32px;
    }
  `]
})
export class LoginComponent {
  private readonly authService = inject(AuthService);

  login(): void {
    this.authService.initiateOAuth();
  }
}
