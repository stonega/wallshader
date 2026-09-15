import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import WebKit from 'gi://WebKit?version=6.0';
import { ROOT } from './paths.js';
import { rendererPreset } from './images.js';

// WebKit's Skia GPU painting can corrupt animated canvas layers on this stack.
// Rasterize page content with Skia's CPU backend; WebGL and compositing stay
// accelerated. Set before WebKit launches, and honor explicit diagnostic overrides.
GLib.setenv('WEBKIT_SKIA_ENABLE_CPU_RENDERING', '1', false);

export class Preview {
  constructor(onError, onDiagnostics = null) {
    this._pending = new Map();
    this._nextId = 0;
    this._queue = Promise.resolve();
    this._closed = false;
    this._debugEnabled = false;
    this.ready = new Promise((resolve, reject) => {
      this._resolveReady = resolve;
      this._rejectReady = reject;
    });
    // A consumer may not have attached its startup handler yet.
    this.ready.catch(() => {});
    const manager = new WebKit.UserContentManager();
    manager.register_script_message_handler('wallshader', null);
    manager.connect(
      'script-message-received::wallshader',
      (_manager, value) => {
        try {
          const message = JSON.parse(value.to_string());
          if (message.type === 'ready') this._resolveReady();
          if (
            message.type === 'diagnostics' &&
            !this._closed &&
            this._debugEnabled
          )
            onDiagnostics?.(message);
          if (message.type === 'error')
            this._fail(new Error(message.message), onError);
          if (message.type === 'response') {
            const pending = this._pending.get(message.id);
            if (!pending) return;
            GLib.source_remove(pending.timeout);
            this._pending.delete(message.id);
            if (message.error) pending.reject(new Error(message.error));
            else pending.resolve(message.result);
          }
        } catch (error) {
          this._fail(error, onError);
        }
      },
    );
    this.widget = new WebKit.WebView({
      user_content_manager: manager,
      hexpand: true,
      vexpand: true,
    });
    const settings = this.widget.get_settings();
    settings.enable_webgl = true;
    settings.enable_write_console_messages_to_stdout = true;
    settings.enable_developer_extras = GLib.getenv('WALLSHADER_DEBUG') === '1';
    this.widget.connect('context-menu', () => true);
    this.widget.connect('web-process-terminated', () =>
      this._fail(
        new Error(
          'The preview stopped. Reopen Wallshader to restart the renderer.',
        ),
        onError,
      ),
    );
    this.widget.connect('load-failed', (_view, _event, _uri, error) => {
      this._fail(error, onError);
      return true;
    });
    const uri = Gio.File.new_for_path(
      GLib.build_filenamev([ROOT, 'build', 'renderer', 'index.html']),
    ).get_uri();
    this.widget.connect('decide-policy', (_view, decision, type) => {
      if (
        type === WebKit.PolicyDecisionType.NAVIGATION_ACTION &&
        decision.get_navigation_action().get_request().get_uri() !== uri
      ) {
        decision.ignore();
        return true;
      }
      return false;
    });
    this.widget.load_uri(uri);
    this._startupTimeout = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT,
      30000,
      () => {
        this._startupTimeout = null;
        this._fail(
          new Error(
            'The preview did not start. Check that WebKitGTK and your graphics driver support WebGL 2.',
          ),
          onError,
        );
        return GLib.SOURCE_REMOVE;
      },
    );
    this.ready.then(
      () => {
        if (this._startupTimeout) GLib.source_remove(this._startupTimeout);
        this._startupTimeout = null;
      },
      () => {},
    );
  }

  _fail(error, onError) {
    if (this._closed) return;
    if (this._startupTimeout) GLib.source_remove(this._startupTimeout);
    this._startupTimeout = null;
    this._error = error;
    this._rejectReady(error);
    for (const pending of this._pending.values()) {
      GLib.source_remove(pending.timeout);
      pending.reject(error);
    }
    this._pending.clear();
    onError(error);
  }

  async evaluate(script) {
    await this.ready;
    if (this._closed) throw new Error('The preview has closed.');
    if (this._error) throw this._error;
    return new Promise((resolve, reject) =>
      this.widget.evaluate_javascript(
        `${script}; true;`,
        -1,
        null,
        null,
        null,
        (view, result) => {
          try {
            resolve(view.evaluate_javascript_finish(result));
          } catch (error) {
            reject(error);
          }
        },
      ),
    );
  }

  select(preset) {
    return this.request('select', {
      preset: JSON.parse(JSON.stringify(preset)),
    });
  }
  pause(paused) {
    return this.evaluate(`window.wallshader.pause(${JSON.stringify(paused)})`);
  }

  setDebug(enabled) {
    if (this._debugEnabled === enabled) return Promise.resolve();
    this._debugEnabled = enabled;
    return this.evaluate(`window.wallshader.debug(${JSON.stringify(enabled)})`);
  }

  request(method, args = {}) {
    const operation = this._queue.then(async () => {
      await this.ready;
      if (this._closed) throw new Error('The preview has closed.');
      if (GLib.getenv('WALLSHADER_TRACE') === '1')
        console.log(`Render request: ${method} ${args.preset?.name ?? ''}`);
      if (args.preset)
        args = { ...args, preset: await rendererPreset(args.preset) };
      return new Promise((resolve, reject) => {
        const id = ++this._nextId;
        const timeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 30000, () => {
          this._pending.delete(id);
          reject(
            new Error(
              `Rendering ${args.preset?.name ?? method} took too long. Try a smaller image size.`,
            ),
          );
          return GLib.SOURCE_REMOVE;
        });
        this._pending.set(id, { resolve, reject, timeout });
        this.evaluate(
          `window.wallshader.request(${id}, ${JSON.stringify(method)}, ${JSON.stringify(args)})`,
        ).catch((error) => {
          if (this._pending.delete(id)) {
            GLib.source_remove(timeout);
            reject(error);
          }
        });
      });
    });
    this._queue = operation.catch(() => {});
    return operation;
  }

  close() {
    // Stop diagnostic callbacks even if the WebView outlives its parent window.
    this.widget.evaluate_javascript(
      'window.wallshader?.debug(false)',
      -1,
      null,
      null,
      null,
      null,
    );
    this._debugEnabled = false;
    this._fail(new Error('The preview has closed.'), () => {});
    this._closed = true;
    if (this._startupTimeout) GLib.source_remove(this._startupTimeout);
    this.widget.stop_loading();
  }
}
