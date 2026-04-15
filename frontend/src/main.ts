import { bootstrapApplication } from '@angular/platform-browser';
import { ModuleRegistry, AllCommunityModule } from 'ag-grid-community';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';

ModuleRegistry.registerModules([AllCommunityModule]);

bootstrapApplication(AppComponent, appConfig).catch((err) =>
  console.error(err)
);
