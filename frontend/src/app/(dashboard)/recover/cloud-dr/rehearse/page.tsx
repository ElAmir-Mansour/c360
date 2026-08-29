// Cloud DR · Rehearse failover.
//
// The "rehearse failover" entry from the Cloud DR region/AZ view ties into the
// SHARED rehearsal flow — the SAME component IT DR uses (re-exported, never
// forked). Re-exporting keeps a single rehearsal surface so a fix lands once;
// the Cloud DR workspace links here with the selected recovery scope.
export { default } from '../../../dr/rehearse/page';
