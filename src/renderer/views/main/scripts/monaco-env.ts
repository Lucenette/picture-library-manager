// ============================================================
// Monaco 的装配：worker、主题、JS 语言服务
//
// 只被「脚本管理」页引用，所以整块（含 monaco 本体）只在你进那一页时才进依赖图。
//
// 版本是 0.57：它的 exports 是 { ".": ..., "./*": "./esm/vs/*.js" }，于是
//   · 深导入要省掉 esm/vs 前缀（monaco-editor/editor/editor.worker，而不是 0.55 那种写法）；
//   · 样式由 monaco 自己的模块 import 进来，不再需要手动引 min/vs/editor/editor.main.css；
//   · 入口就用裸包名，它注册全部语言定义 + JS/TS 语言服务。
// ============================================================

import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker&inline';
import TsWorker from 'monaco-editor/language/typescript/ts.worker?worker&inline';

/**
 * CommonJS 全局的声明。
 *
 * 脚本是 CJS，没有这一段，语言服务会把 require / module 标成未定义；有了它补全也能用。
 */
const CJS_GLOBALS = `declare function require(id: string): any;
declare var module: { exports: any };
declare var exports: any;
declare var __filename: string;
declare var __dirname: string;`;

/**
 * worker 用 inline（blob）而不是独立文件。
 *
 * 打包后渲染进程是 file:// 页面，Chromium 不给这种来源加载独立文件的 Worker；
 * inline 变体走 blob，与来源无关。JS/TS 之外的语言我们不用，一律退回编辑器 worker。
 */
(globalThis as { MonacoEnvironment?: { getWorker(workerId: string, label: string): Worker } }).MonacoEnvironment = {
  getWorker(_workerId: string, label: string): Worker {
    return label === 'javascript' || label === 'typescript' ? new TsWorker() : new EditorWorker();
  },
};

/** 与界面同一套暗色：底色取 .app-main 的 #1e1f22 */
monaco.editor.defineTheme('plmanager-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#1e1f22',
    'editorGutter.background': '#1e1f22',
    'editor.lineHighlightBackground': '#26282c',
    'editorLineNumber.foreground': '#5e6268',
    'editorLineNumber.activeForeground': '#a0a3a9',
  },
});

// 只配 JS 一侧：脚本是 CommonJS 的 .js，typescriptDefaults 不碰。
// 语义校验关掉——require('sharp') 这类解析不到的模块会被报成假错，真错误源是主进程的编译。
//
// 注意走的是具名导出 typescript：0.57 里 monaco.languages.typescript 只剩一个 deprecated 壳，
// 语言服务整套（javascriptDefaults / ScriptTarget / ModuleKind）挂在包根的 typescript 上。
monaco.typescript.javascriptDefaults.setDiagnosticsOptions({
  noSemanticValidation: true,
  noSyntaxValidation: false,
  // 建议类诊断（如 80001「这是 CommonJS，可以转成 ES 模块」）也关掉：
  // 我们的脚本就是 CJS，这条建议是错的，它只会出现在悬停里干扰人
  noSuggestionDiagnostics: true,
});
monaco.typescript.javascriptDefaults.setCompilerOptions({
  allowJs: true,
  allowNonTsExtensions: true,
  target: monaco.typescript.ScriptTarget.ESNext,
  module: monaco.typescript.ModuleKind.CommonJS,
});
monaco.typescript.javascriptDefaults.addExtraLib(CJS_GLOBALS, 'plmanager-cjs.d.ts');

/** 等语言激活的上限：超时就当没点着，让这次预热以失败收场，而不是无声地挂住 */
const WARM_UP_TIMEOUT_MS = 5000;

/**
 * 提前把 TypeScript 语言服务点着。
 *
 * 链条是三步，都得自己走：语言服务（providers + WorkerManager）要等**这个语言第一次被要求富语言特性**
 * 才建起来——0.57 里 `languages.onLanguage` 监听的是 `onDidRequestRichLanguageFeatures`，而只有把模型
 * 挂进编辑器才会请求它（光 `createModel` 只会请求基本的 tokenization）；worker 又要等第一次真要服务时
 * 才创建。所以这里用**一次性离屏编辑器**把前两步走完，再真的要一次语言服务——这一步才会解码内联的
 * `ts.worker`、在里面把 TypeScript 求值起来并同步资源，返回时语言服务已经就绪。
 *
 * 用完就拆，拆掉不影响：worker 归 WorkerManager 持有，这个版本没有空闲回收
 * （`setMaximumWorkerIdleTime` 是空实现），只有配置变更或 `dispose()` 才会停它——上面那几条
 * `javascriptDefaults.*` 都发生在编辑器出现之前，不会把已经点着的 worker 停掉。
 */
export async function warmUpTypeScript(): Promise<void> {
  // 先订阅再建编辑器：激活是一次性的，错过就永远等不到
  const ready = new Promise<void>((resolve) => {
    const listener = monaco.languages.onLanguage('javascript', () => {
      listener.dispose();
      resolve();
    });
  });

  // 离屏但要有尺寸：0×0 的容器会让布局与 tokenization 走退化路径
  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;left:-10000px;top:0;width:600px;height:300px;';
  document.body.appendChild(host);

  const model = monaco.editor.createModel('', 'javascript');
  // 预热不关心界面：把只有真编辑时才值得做的活关掉
  const editor = monaco.editor.create(host, {
    model,
    minimap: { enabled: false },
    folding: false,
  });

  try {
    await Promise.race([ready, delay(WARM_UP_TIMEOUT_MS)]);
    const getWorker = await monaco.typescript.getJavaScriptWorker();
    await getWorker(model.uri);
  } finally {
    editor.dispose();
    model.dispose();
    host.remove();
  }
}

/** 预热的超时兜底 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export { monaco };
