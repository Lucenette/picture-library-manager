import { parentPort } from 'worker_threads';
import { analyzeImage, type ThumbnailRequest, type ThumbnailResponse } from '@/image/thumbnail-decode';

/**
 * 缩略图工作线程。
 *
 * 整图解码与 Jimp 缩放都很吃 CPU，放在主进程会把窗口消息一起拖住；
 * 这里常驻一个线程逐条处理，由 ThumbnailPool 负责调度。
 */
parentPort?.on('message', (request: ThumbnailRequest) => {
  void handle(request);
});

async function handle(request: ThumbnailRequest): Promise<void> {
  try {
    const metrics = await analyzeImage(request.filePath);
    parentPort?.postMessage({ id: request.id, metrics } satisfies ThumbnailResponse);
  } catch (error) {
    parentPort?.postMessage({ id: request.id, error: (error as Error).message } satisfies ThumbnailResponse);
  }
}
