import { MAX_FILES, MAX_TEXT, MAX_TOTAL_TEXT, safePath, wantsText, readPriority } from './inventory.ts';
import type { Entry } from './types.ts';
type Handle = { kind: string; name: string; values(): AsyncIterable<Handle>; getFile(): Promise<File> };
type Message = { handle?: Handle; files?: File[] };
const scope = self as unknown as { onmessage: ((event: MessageEvent<Message>) => void) | null; postMessage(data: unknown): void };
scope.onmessage = async ({ data }) => {
  const entries: Entry[] = [], sources = new Map<string, File>(), warnings = new Set<string>();
  let totalText = 0, visited = 0;
  function accept(file: File, path: string) {
    if (!safePath(path)) return;
    if (++visited > MAX_FILES) { warnings.add('一覧の確認上限50,000件に達しました。フォルダを絞ってください。'); return; }
    entries.push({ path, size: file.size }); if (wantsText(path)) sources.set(path, file);
    if (entries.length % 100 === 0) scope.postMessage({ type: 'progress', count: entries.length });
  }
  async function walk(handle: Handle, prefix = ''): Promise<void> {
    for await (const child of handle.values()) {
      const path = prefix + child.name; if (!safePath(path)) continue;
      if (visited > MAX_FILES) return;
      if (child.kind === 'directory') await walk(child, path + '/');
      else try { accept(await child.getFile(), path); } catch { warnings.add('一部のファイルを読み取れませんでした。'); }
    }
  }
  try {
    const name = data.handle?.name ?? data.files?.[0]?.webkitRelativePath.split('/')[0] ?? 'project';
    if (data.handle) await walk(data.handle);
    else for (const file of data.files ?? []) { const path = file.webkitRelativePath.split('/').slice(1).join('/') || file.name; accept(file, path); if (visited > MAX_FILES) break; }
    for (const entry of [...entries].sort((a, b) => readPriority(a.path) - readPriority(b.path) || a.path.localeCompare(b.path))) {
      const file = sources.get(entry.path); if (!file) continue;
      if (file.size > MAX_TEXT || totalText + file.size > MAX_TOTAL_TEXT) { warnings.add('テキスト読み取り上限に達したファイルがあります。未読の実行ファイルは判定を保留します。'); continue; }
      totalText += file.size; try { entry.text = await file.text(); } catch { warnings.add('一部のファイルを読み取れませんでした。'); }
    }
    scope.postMessage({ type: 'complete', entries, name, warnings: [...warnings] });
  } catch { scope.postMessage({ type: 'error', message: 'フォルダを読み取れませんでした。アクセス権を確認して再選択してください。' }); }
};
