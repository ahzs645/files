import { useWorkspace } from './backend';
import { documentDownloadActive, separateDocumentBrowser, sourceCaptureActive } from './document-run';
import { useScheduleBrowsers } from './procurement/ScheduleControl';

export function useDocumentBrowsers(submitted?: string) {
  const { model } = useWorkspace();
  const capturing = sourceCaptureActive(model?.captureRuns);
  const downloading = documentDownloadActive(model?.documentRuns, submitted);
  const browsers = useScheduleBrowsers(capturing || downloading);
  const separate = separateDocumentBrowser(browsers.data);
  return {
    capturing, downloading, separate,
    downloadBlocked: !model || downloading || (capturing && !separate),
    captureBlocked: !model || capturing || (downloading && !separate),
  };
}
