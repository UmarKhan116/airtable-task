import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'dashboard',
    pathMatch: 'full',
  },
  {
    path: 'auth',
    children: [
      {
        path: 'login',
        loadComponent: () =>
          import('./features/auth/login/login.component').then((m) => m.LoginComponent),
      },
      {
        path: 'callback',
        loadComponent: () =>
          import('./features/auth/callback/oauth-callback.component').then(
            (m) => m.OAuthCallbackComponent
          ),
      },
    ],
  },
  {
    path: 'dashboard',
    canActivate: [authGuard],
    children: [
      {
        path: '',
        redirectTo: 'raw-data',
        pathMatch: 'full',
      },
      {
        path: 'raw-data',
        loadComponent: () =>
          import('./features/raw-data/raw-data.component').then((m) => m.RawDataComponent),
        title: 'Raw Data',
      },
    ],
  },
  {
    path: '**',
    redirectTo: 'dashboard',
  },
];
