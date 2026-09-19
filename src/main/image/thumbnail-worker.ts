import { parentPort } from 'worker_threads';
import type { ThumbnailEngineName } from '@common/types';
import { generateThumbnail } from '@/image/thumbnail-sharp';

// ------------------------------------------------------------
// 类型
// ------------------------------------------------------------

/** 派发给工作线程的任务 */
export interface ThumbnailRequest {
  id: number;
  filePath: string;
}

/** 工作线程的回复 */
export interface ThumbnailResponse {
  id: number;
  /** base64 Data URL；生成不出来时为 null */
  thumbnail?: string | null;
  /** 原图宽高，读不出来时为 0 */
  width?: number;
  height?: number;
  /** 实际使用的解码引擎 */
  engine?: ThumbnailEngineName;
  error?: string;
}

// ------------------------------------------------------------
// 线程入口
// ------------------------------------------------------------

/**
 * 缩略图工作线程。
 *
 * 解码很吃资源；放在独立线程里，主进程才不会因为一次整图解码而卡住窗口消息。
 * 由 ThumbnailPool 负责调度。
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
      width: outcome.width,
      height: outcome.height,
      engine: 'sharp',
    } satisfies ThumbnailResponse);
  } catch (error) {
    parentPort?.postMessage({ id: request.id, error: (error as Error).message } satisfies ThumbnailResponse);
  }
}
