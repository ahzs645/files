// `@zoer/plugin-ui/analysis` for the Societyer build (Zoer's module re-exports its Modal and PageTabs relatively, so override them here too).
export * from '@zoer/plugin-ui-host/analysis';
export { Modal, PageTabs } from './kit';
