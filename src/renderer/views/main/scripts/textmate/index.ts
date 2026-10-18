// ============================================================
// 把脚本编辑器的词法器从 Monaco 内置的 JavaScript 分词器换成 TextMate
//
// 链条：onig.wasm（`?url&inline` 内联成 data URL）→ vscode-oniguruma → vscode-textmate 的 Registry
//       → javascript.tmLanguage.json（`?raw`）→ monaco.languages.setTokensProvider('javascript', …)
//
// 两条约束值得记在这里：
//   · 词法器必须在任何 javascript model 建起来之前设好。Monaco 内置的 JavaScript 词法器是一个惰性
//     工厂，模型第一次要词法时才创建并注册；晚于它就轮到它把我们盖掉（见 tokenizationRegistry.js
//     的 getOrCreate / _create）。所以预热与编辑器都先 await initTextMate()。
//   · wasm 不能靠运行时 fetch。打包后是 file:// 页面且 webSecurity 开着，file:// 取不到；于是交给
//     Vite 内联成 data URL，再在适配层解回字节。
// ============================================================

import { languages } from 'monaco-editor';
import { createOnigScanner, createOnigString, loadWASM } from 'vscode-oniguruma';
import onigWasmDataUrl from 'vscode-oniguruma/release/onig.wasm?url&inline';
import { INITIAL, parseRawGrammar, Registry } from 'vscode-textmate';

import { createLogger } from '@/services/log-service';

import { decodeDataUrl, toLineTokens, TokenizerState } from './adapter';
import grammarText from './javascript.tmLanguage.json?raw';

/** 本模块的日志（category `renderer.textmate`） */
const log = createLogger('textmate');

/** 换词法器的语言：脚本只有 .js，没有 typescript 模型，所以首版只做它 */
const LANGUAGE_ID = 'javascript';
/** 语法声明的根作用域，必须与 javascript.tmLanguage.json 的 scopeName 一致 */
const SCOPE_NAME = 'source.js';
/** 等初始化的上限：超时就按失败处理，不让编辑器停在没有编辑器的状态 */
const INIT_TIMEOUT_MS = 10_000;

/** 初始化结果；失败时带原因，脚本页据此出可见的降级提示 */
export type TextMateSetup = { ok: true } | { ok: false; reason: string };

/** 只真正跑一次；成功或失败都记在这里，重复调用拿到同一个 Promise */
let pending: Promise<TextMateSetup> | null = null;
/** 超时之后不要再设词法器：那时编辑器已经按内置词法器建好了 */
let abandoned = false;

/**
 * 初始化 TextMate 词法器。
 *
 * 幂等：无论成败都只真正跑一次。**不会 reject**——失败以 `{ ok: false }` 结束并写日志，
 * 调用方不必逐个 try/catch，也不会留下没人接的 unhandled rejection。
 */
export function initTextMate(): Promise<TextMateSetup> {
  pending ??= withTimeout(run());
  return pending;
}

/** 给初始化套一个上限；超时只落结果与日志，不去强杀已经发出的异步工作 */
async function withTimeout(work: Promise<TextMateSetup>): Promise<TextMateSetup> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<TextMateSetup>((resolve) => {
    timer = setTimeout(() => {
      abandoned = true;
      log.error(`textmate init timed out after ${INIT_TIMEOUT_MS}ms`);
      resolve({ ok: false, reason: `初始化超时（${INIT_TIMEOUT_MS}ms）` });
    }, INIT_TIMEOUT_MS);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** 真正的初始化：解码 wasm、建 Registry、编译语法、顶掉内置词法器 */
async function run(): Promise<TextMateSetup> {
  try {
    await loadWASM(decodeDataUrl(onigWasmDataUrl));

    const registry = new Registry({
      onigLib: Promise.resolve({ createOnigScanner, createOnigString }),
      loadGrammar: (scopeName) => Promise.resolve(
        scopeName === SCOPE_NAME ? parseRawGrammar(grammarText, 'javascript.tmLanguage.json') : null,
      ),
    });
    const grammar = await registry.loadGrammar(SCOPE_NAME);
    if (grammar === null) {
      throw new Error(`grammar not found: ${SCOPE_NAME}`);
    }
    if (abandoned) {
      return { ok: false, reason: '初始化超时' };
    }

    languages.setTokensProvider(LANGUAGE_ID, {
      getInitialState: () => new TokenizerState(INITIAL),
      tokenize: (line, state) => {
        const previous = state instanceof TokenizerState ? state.stack : null;
        const { tokens, stack } = toLineTokens(grammar, line, previous);
        return { tokens, endState: new TokenizerState(stack) };
      },
    });
    log.info(`textmate tokenizer installed for ${LANGUAGE_ID} (${SCOPE_NAME})`);
    return { ok: true };
  } catch (error) {
    log.error('textmate init failed', error);
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}
