import { analyze } from './analyze.ts';
self.onmessage = ({ data }) => {
  try { self.postMessage({ id: data.id, analysis: analyze(data.entries, data.root, data.name, data.warnings, data.output) }); }
  catch { self.postMessage({ id: data.id, error: '解析できない構文または構成がありました。対象アプリを絞って再確認してください。' }); }
};
