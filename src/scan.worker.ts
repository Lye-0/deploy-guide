import { analyze, MAX_FILES, MAX_TEXT, MAX_TOTAL_TEXT, safePath, wantsText } from './analyze.ts';
import type { Entry } from './types.ts';
type Handle = { kind: string; name: string; values(): AsyncIterable<Handle>; getFile(): Promise<File> };
type Message = { handle?: Handle; files?: File[] };
const scope = self as unknown as { onmessage: ((event: MessageEvent<Message>) => void) | null; postMessage(data: unknown): void };
scope.onmessage = async ({ data }) => {
  const entries: Entry[] = [];
  const warnings = new Set<string>();
  let totalText = 0, visited = 0;
  const accept = async (file: File, path: string) => {
    if (!safePath(path)) return;
    const entry: Entry = { path, size: file.size };
    if (wantsText(path)) {
      if (file.size > MAX_TEXT || totalText + file.size > MAX_TOTAL_TEXT) warnings.add('テキスト読み取り上限に達したため、一部のコードは未確認です。');
      else { totalText += file.size; try { entry.text = await file.text(); } catch { warnings.add('一部のファイルを読み取れませんでした。'); } }
    }
    entries.push(entry);
    if (entries.length % 100 === 0) scope.postMessage({ type: 'progress', count: entries.length });
  };
  const walk = async (handle: Handle, prefix = ''): Promise<void> => {
    for await (const child of handle.values()) {
      if (++visited > MAX_FILES) { warnings.add('一覧の確認上限50,000件に達しました。フォルダを絞って再解析してください。'); return; }
      const path = prefix + child.name;
      if (!safePath(path)) continue;
      if (child.kind === 'directory') { await walk(child, path + '/'); if (visited > MAX_FILES) return; }
      else { try { await accept(await child.getFile(), path); } catch { warnings.add('一部のファイルを読み取れませんでした。'); } }
    }
  };
  try {
    let name = 'project';
    if (data.handle) { name = data.handle.name; await walk(data.handle); }
    else if (data.files) {
      name = data.files[0]?.webkitRelativePath.split('/')[0] || 'project';
      if (data.files.length > MAX_FILES) warnings.add('一覧の確認上限50,000件に達しました。フォルダを絞って再解析してください。');
      for (const f of data.files.slice(0, MAX_FILES)) await accept(f, f.webkitRelativePath.split('/').slice(1).join('/') || f.name);
    }
    scope.postMessage({ type: 'complete', entries, name, warnings: [...warnings], analysis: analyze(entries, '', name, [...warnings]) });
  } catch { scope.postMessage({ type: 'error', message: 'フォルダを読み取れませんでした。アクセス権を確認して、もう一度選択してください。' }); }
};
