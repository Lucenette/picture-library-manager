import { parentPort } from 'worker_threads';
import { generateThumbnail } from '@/image/thumbnail-engine';
import type { ThumbnailRequest, ThumbnailResponse } from '@/image/thumbnail-decode';

/**
 * 缩略图工作线程。
 *
 * 无论走 sharp 还是内置解码器，解码都很吃资源；放在独立线程里，主进程才不会
 * 因为一次整图解码而卡住窗口消息。由 ThumbnailPool 负责调度。
 */
parentPort?.on('message', (request: ThumbnailRequest) => {
  void handle(request);
});

async function handle(request: ThumbnailRequest): Promise<void> {
  try {
    const outcome = await generateThumbnail(request.filePath);
    parentPort?.postMessage({
      id: request.id,
      thumbnail: outcome.thumbnail,
      engine: outcome.engine,
    } satisfies ThumbnailResponse);
  } catch (error) {
    parentPort?.postMessage({ id: request.id, error: (error as Error).message } satisfies ThumbnailResponse);
  }
}
