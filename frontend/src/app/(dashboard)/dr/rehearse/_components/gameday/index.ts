/**
 * Public surface of the rehearse Game Day feature: the composed authoring +
 * evidence panel, its constituent dialog / reader components, and the
 * feature-local bilingual labels. Imported by the rehearse route page.
 */

export { GameDayPanel, type GameDayPanelProps } from './gameday-panel';
export {
  CreateScenarioDialog,
  type CreateScenarioDialogProps,
  type ScenarioGroupOption,
} from './create-scenario-dialog';
export { ScorecardPanel, type ScorecardPanelProps, type ScorecardRunOption } from './scorecard-panel';
export { DrillDiffPanel, type DrillDiffPanelProps } from './drill-diff-panel';
export {
  gameDayLabelBundle,
  gameDayLabels,
  useGameDayLabels,
  type GameDayLabels,
  type DrillDiffLabels,
} from './gameday-labels';
