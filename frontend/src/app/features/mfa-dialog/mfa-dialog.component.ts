import { Component, Inject, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AuthService } from '../../core/services/auth.service';

export interface MfaDialogData {
  sessionId: string;
  mfaType: 'totp' | 'sms' | 'none';
}

export interface MfaDialogResult {
  success: boolean;
}

@Component({
  selector: 'app-mfa-dialog',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatProgressSpinnerModule,
  ],
  template: `
    <h2 mat-dialog-title>
      <mat-icon>security</mat-icon>
      Two-Factor Authentication
    </h2>

    <mat-dialog-content class="mfa-dialog-body">
      <p class="mfa-description">
        @if (data.mfaType === 'totp') {
          Enter the 6-digit code from your authenticator app.
        } @else {
          Enter the verification code sent to your phone or email.
        }
      </p>

      <form [formGroup]="form">
        <mat-form-field appearance="outline" class="full-width" subscriptSizing="dynamic">
          <mat-label>Verification Code</mat-label>
          <input
            matInput
            formControlName="code"
            placeholder="000000"
            maxlength="8"
            autocomplete="one-time-code"
            inputmode="numeric"
          />
          <mat-icon matPrefix>pin</mat-icon>
          @if (form.get('code')?.hasError('required') && form.get('code')?.touched) {
            <mat-error>Code is required</mat-error>
          }
          @if (form.get('code')?.hasError('pattern') && form.get('code')?.touched) {
            <mat-error>Code must be 6–8 digits</mat-error>
          }
        </mat-form-field>

        @if (errorMessage()) {
          <p class="error-message">
            <mat-icon>error_outline</mat-icon>
            {{ errorMessage() }}
          </p>
        }
      </form>
    </mat-dialog-content>

    <mat-dialog-actions class="mfa-dialog-actions" align="end">
      <button mat-button [mat-dialog-close]="{ success: false }" [disabled]="isLoading()">
        Cancel
      </button>
      <button
        mat-raised-button
        color="primary"
        (click)="submit()"
        [disabled]="form.invalid || isLoading()"
      >
        @if (isLoading()) {
          <mat-spinner diameter="20"></mat-spinner>
        } @else {
          Verify
        }
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    :host {
      display: block;
    }

    h2[mat-dialog-title] {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0;
      padding: 0 0 8px;
      mat-icon { color: #1976d2; }
    }

    /* Drop default content max-height so a tiny overflow does not show a scrollbar */
    .mfa-dialog-body.mat-mdc-dialog-content {
      max-height: none !important;
      overflow: visible !important;
      padding-top: 0;
      padding-bottom: 4px;
    }

    .mfa-description {
      color: rgba(0,0,0,0.6);
      margin: 0 0 12px;
    }

    .full-width { width: 100%; }

    .error-message {
      display: flex;
      align-items: center;
      gap: 4px;
      color: #f44336;
      font-size: 14px;
      margin: 8px 0 0;
      mat-icon { font-size: 16px; width: 16px; height: 16px; }
    }

    .mfa-dialog-actions.mat-mdc-dialog-actions {
      gap: 8px;
      padding: 16px 24px 22px !important;
      margin: 0;
      flex-shrink: 0;
    }

    button[mat-raised-button] {
      min-width: 88px;
    }
  `]
})
export class MfaDialogComponent {
  private readonly authService = inject(AuthService);
  private readonly fb = inject(FormBuilder);
  readonly dialogRef = inject(MatDialogRef<MfaDialogComponent>);

  readonly isLoading = signal(false);
  readonly errorMessage = signal<string | null>(null);

  form = this.fb.group({
    code: ['', [Validators.required, Validators.pattern(/^\d{6,8}$/)]],
  });

  constructor(@Inject(MAT_DIALOG_DATA) public readonly data: MfaDialogData) {}

  submit(): void {
    if (this.form.invalid) return;

    const code = this.form.value.code!;
    this.isLoading.set(true);
    this.errorMessage.set(null);

    this.authService.submitMfa(this.data.sessionId, code).subscribe({
      next: () => {
        this.isLoading.set(false);
        this.dialogRef.close({ success: true } satisfies MfaDialogResult);
      },
      error: (err) => {
        this.isLoading.set(false);
        this.errorMessage.set(
          err?.error?.message ?? 'Invalid code. Please try again.'
        );
        this.form.get('code')?.reset();
      },
    });
  }
}
