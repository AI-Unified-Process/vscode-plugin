import { spawn } from 'node:child_process';
import * as vscode from 'vscode';
import { serverUrl } from './core/plantuml';

/** Which renderer produced an SVG — shown in the preview's status line. */
export type RendererKind = 'local' | 'server';

export interface RenderResult {
  svg: string;
  renderer: RendererKind;
}

/** Thrown when the local PlantUML executable is not installed or not configured. */
class LocalRendererUnavailable extends Error {}

/** Thrown when a render was refused or failed; the message is shown in the preview. */
export class RenderError extends Error {}

const CONSENT_KEY = 'aiup.plantuml.serverConsent';
const LOCAL_ARGS = ['-tsvg', '-pipe', '-charset', 'UTF-8'];

/**
 * Renders PlantUML source to SVG, locally with `plantuml`/`plantuml.jar` when one
 * is available and otherwise through a PlantUML server.
 *
 * Local rendering is the default because the diagram source never leaves the
 * machine; falling back to a server sends it to that server, so the fallback is
 * confirmed once per server and remembered.
 */
export class PlantUmlRenderer {
  constructor(private readonly memento: vscode.Memento) {}

  async render(source: string, cwd: string, token: vscode.CancellationToken): Promise<RenderResult> {
    const config = vscode.workspace.getConfiguration('aiup.plantuml');
    const mode = config.get<string>('renderer', 'auto');

    if (mode !== 'server') {
      try {
        return { svg: await this.renderLocal(source, cwd, config, token), renderer: 'local' };
      } catch (error) {
        if (!(error instanceof LocalRendererUnavailable)) {
          throw error;
        }
        if (mode === 'local') {
          throw new RenderError(
            `${error.message}\n\nInstall PlantUML and put it on the PATH, set "aiup.plantuml.jarPath" ` +
              'to a plantuml.jar, or set "aiup.plantuml.renderer" to "server".',
          );
        }
      }
    }

    const server = config.get<string>('server', 'https://www.plantuml.com/plantuml').trim();
    if (mode !== 'server' && !(await this.allowServer(server))) {
      throw new RenderError(
        `No local PlantUML found and rendering on ${server} was declined.\n\n` +
          'Install PlantUML and put it on the PATH, or set "aiup.plantuml.jarPath" to a plantuml.jar.',
      );
    }
    return { svg: await renderOnServer(source, server, token), renderer: 'server' };
  }

  private renderLocal(
    source: string,
    cwd: string,
    config: vscode.WorkspaceConfiguration,
    token: vscode.CancellationToken,
  ): Promise<string> {
    const jar = config.get<string>('jarPath', '').trim();
    const command = jar
      ? config.get<string>('javaPath', 'java').trim() || 'java'
      : config.get<string>('commandPath', 'plantuml').trim() || 'plantuml';
    const args = jar ? ['-Djava.awt.headless=true', '-jar', jar, ...LOCAL_ARGS] : [...LOCAL_ARGS];
    const timeout = Math.max(1, config.get<number>('timeout', 20)) * 1000;

    return new Promise<string>((resolve, reject) => {
      const child = spawn(command, args, { cwd });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let settled = false;

      const finish = (run: () => void): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        cancel.dispose();
        run();
      };

      const timer = setTimeout(() => {
        child.kill();
        finish(() => reject(new RenderError(`${command} did not finish within ${timeout / 1000}s.`)));
      }, timeout);
      const cancel = token.onCancellationRequested(() => {
        child.kill();
        finish(() => reject(new vscode.CancellationError()));
      });

      child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
      child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
      child.on('error', (error: NodeJS.ErrnoException) => {
        finish(() =>
          reject(
            error.code === 'ENOENT'
              ? new LocalRendererUnavailable(`Local PlantUML renderer "${command}" was not found.`)
              : new RenderError(`Could not run ${command}: ${error.message}`),
          ),
        );
      });
      child.on('close', (code) => {
        finish(() => {
          const svg = Buffer.concat(stdout).toString('utf8');
          if (svg.includes('<svg')) {
            resolve(svg);
            return;
          }
          const message = Buffer.concat(stderr).toString('utf8').trim();
          if (jar && /Unable to access jarfile|no main manifest/i.test(message)) {
            reject(new LocalRendererUnavailable(message));
            return;
          }
          reject(new RenderError(message || `${command} exited with code ${code} and produced no SVG.`));
        });
      });

      child.stdin.on('error', () => {
        // the process died before reading the source; handled by 'error'/'close'
      });
      child.stdin.end(source, 'utf8');
    });
  }

  /** Asks once per server before the first fallback render leaves the machine. */
  private async allowServer(server: string): Promise<boolean> {
    if (this.memento.get<string>(CONSENT_KEY) === server) {
      return true;
    }
    const send = 'Render on the server';
    const choice = await vscode.window.showWarningMessage(
      `No local PlantUML renderer was found. Render the diagram on ${server}? ` +
        'The diagram source is sent to that server.',
      { modal: true },
      send,
    );
    if (choice !== send) {
      return false;
    }
    await this.memento.update(CONSENT_KEY, server);
    return true;
  }
}

async function renderOnServer(
  source: string,
  server: string,
  token: vscode.CancellationToken,
): Promise<string> {
  const controller = new AbortController();
  const cancel = token.onCancellationRequested(() => controller.abort());
  try {
    const response = await fetch(serverUrl(server, 'svg', source), { signal: controller.signal });
    const body = await response.text();
    if (body.includes('<svg')) {
      // A syntax error also comes back as an SVG that says so — show it.
      return body;
    }
    throw new RenderError(`${server} answered ${response.status} ${response.statusText}:\n\n${body.trim()}`);
  } catch (error) {
    if (token.isCancellationRequested) {
      throw new vscode.CancellationError();
    }
    if (error instanceof RenderError) {
      throw error;
    }
    throw new RenderError(`Could not reach ${server}: ${(error as Error).message}`);
  } finally {
    cancel.dispose();
  }
}
