import { defineConfig } from 'vitest/config';
import base from './vite.config';

/**
 * The product suite: fast, required on every change. It covers the workspace,
 * applications, Career Memory, storage, tailoring, DOCX import and download flow.
 * The full historical engine suite runs separately (npm run test:engine).
 */
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    pool: 'threads',
    // A few App integration tests depend on debounce timing; retry before failing.
    retry: 2,
    include: [
      'src/core/careerMemory.test.ts',
      'src/core/applications.test.ts',
      'src/core/composerSources.test.ts',
      'src/core/activity.test.ts',
      'src/core/templateRepair.test.ts',
      'src/storage/draftJournal.test.ts',
      'src/storage/composerPreferences.test.ts',
      'src/storage/defaultBridge.integration-controls.test.ts',
      'src/tailoring/local.test.ts',
      'src/tailoring/flow.test.ts',
      'src/tailoring/ai.test.ts',
      'src/ui/workspace-review.test.ts',
      'src/ui/WorkspaceUpgrade.test.ts',
      'src/ui/memoryInsights.test.ts',
      'src/ui/memoryUpgrade.test.ts',
      'src/ui/workspacePresentation.test.ts',
      'src/ui/previewReview.test.ts',
      'src/ui/export-readiness-ui.test.ts',
      'src/ui/App.integration-controls.test.ts',
      'src/ui/useAiReadiness.test.ts',
      'src/ui/templateDiagnostics.test.ts',
      'src/ui/reviewDecisions.test.ts',
      'src/ui/versionDifferences.test.ts',
      'src/ui/history.test.ts',
      'src/ui/historyPresentation.test.ts',
      'src/core/commands.test.ts',
      'src/import/docx-geometry.test.ts',
      'src/import/docx-page-cap.test.ts',
      'src/import/docx-properties.test.ts',
      'src/import/docxReference.test.ts',
      'src/ui/fileNames.test.ts',
      'src/auth/authActions.test.ts',
    ],
  },
});
